'use strict';

/* globals module, require */

var db = module.parent.require('./database'),
	winston = module.parent.require('winston'),
	engine = require('solr-client'),
	async = module.parent.require('async'),

	LRU = require('lru-cache'),
	titleCache = LRU({ max: 20, maxAge: 1000 * 60 * 60 }),	// Remember the last 20 searches in the past hour
	postCache = LRU({ max: 20, maxAge: 1000 * 60 * 60 }),	// Remember the last 20 searches in the past hour

	topics = module.parent.require('./topics'),
	posts = module.parent.require('./posts'),

	// This method is necessary until solr-client 0.3.x is released
	escapeSpecialChars = function(s) {
		return s.replace(/([\+\-&\|!\(\)\{\}\[\]\^"~\*\?:\\\ ])/g, function(match) {
			return '\\' + match;
		});
	},

	Solr = {
		/*
			Defaults configs:
			host: localhost
			port: 8983
			core: ''
			path: '/solr'
			enabled: undefined (false)
			titleField: 'title_t'
			contentField: 'description_t'
		*/
		config: {},	// default is localhost:8983, '' core, '/solr' path
		client: undefined,
		indexStatus: {
			running: false,
			current: 0,
			total: 0
		}
	};

Solr.init = function(data, callback) {
	var pluginMiddleware = require('./middleware'),
		render = function(req, res) {
			// Regenerate csrf token
			var token = req.csrfToken();

			res.render('admin/plugins/solr', {
				ping: res.locals.ping,
				enabled: res.locals.enabled,
				stats: res.locals.stats,
				csrf: token
			});
		};

	data.router.get('/admin/plugins/solr', data.middleware.applyCSRF, data.middleware.admin.buildHeader, pluginMiddleware.ping, pluginMiddleware.getEnabled, pluginMiddleware.getStats, render);
	data.router.get('/api/admin/plugins/solr', data.middleware.applyCSRF, pluginMiddleware.ping, pluginMiddleware.getEnabled, pluginMiddleware.getStats, render);

	// Utility
	data.router.post('/admin/plugins/solr/rebuild', Solr.rebuildIndex);
	data.router.get('/admin/plugins/solr/rebuildProgress', Solr.getIndexProgress);
	data.router.post('/admin/plugins/solr/toggle', Solr.toggle);
	data.router.delete('/admin/plugins/solr/flush', Solr.flush);

	Solr.getSettings(Solr.connect);

	callback();
};

Solr.ping = function(callback) {
	if (Solr.client) {
		Solr.client.ping(callback);
	} else {
		callback(new Error('not-connected'));
	}
};

Solr.checkConflict = function() {
	if (module.parent.exports.libraries['nodebb-plugin-dbsearch']) {
		return true;
	} else {
		return false;
	}
};

Solr.getNotices = function(notices, callback) {
	Solr.ping(function(err) {
		var solrNotices = [
				{ done: !err ? true : false, doneText: 'Solr connection OK', notDoneText: 'Could not connect to Solr server' },
				{ done: parseInt(Solr.config.enabled, 10) || false, doneText: 'Solr Indexing Enabled', notDoneText: 'Solr Indexing Disabled' }
			];

		callback(null, notices.concat(solrNotices));
	});
};

Solr.getSettings = function(callback) {
	db.getObject('settings:solr', function(err, config) {
		Solr.config = {};
		if (!err) {
			for(var k in config) {
				if (config.hasOwnProperty(k) && config[k].length && !Solr.config.hasOwnProperty(k)) {
					Solr.config[k] = config[k];
				}
			}
		} else {
			winston.error('[plugin:solr] Could not fetch settings, assuming defaults.');
		}

		callback();
	});
};

Solr.getRecordCount = function(callback) {
	var query = Solr.client.createQuery().q('*:*').start(0).rows(0);

	Solr.client.search(query, function(err, obj) {
		if (!err && obj && obj.response) {
			callback(undefined, obj.response.numFound);
		} else {
			callback(err, 0);
		}
	});
};

Solr.getTopicCount = function(callback) {
	var query = Solr.client.createQuery().q((Solr.config.titleField || 'title_t') + ':*').start(0).rows(0);

	Solr.client.search(query, function(err, obj) {
		if (!err && obj && obj.response) {
			callback(undefined, obj.response.numFound);
		} else {
			callback(err, 0);
		}
	});
};

Solr.connect = function() {
	if (Solr.client) {
		delete Solr.client;
	}

	Solr.client = engine.createClient(Solr.config);

	if (Solr.config.username && Solr.config.password) {
		Solr.client.basicAuth(Solr.config.username, Solr.config.password);
	}
};

Solr.adminMenu = function(custom_header, callback) {
	custom_header.plugins.push({
		'route': '/plugins/solr',
		'icon': 'fa-search',
		'name': 'Apache Solr'
	});

	callback(null, custom_header);
};

Solr.search = function(data, callback) {
	if (Solr.checkConflict()) {
		// The dbsearch plugin was detected, abort search!
		winston.warn('[plugin/solr] Another search plugin (dbsearch) is enabled, so search via Solr was aborted.');
		return callback(null, data);
	}
	var isTopic = data.index === 'topic';
	var field = isTopic ? 'tid_i' : 'pid_i';
	// Determine which cache to use
	var cache = isTopic ? titleCache : postCache;

	if (cache.has(data.query)) {
		callback(null, cache.get(data.query));
	} else {
		var fields = {},
			query;

		// Populate Fields
		if (isTopic) { fields[Solr.config.titleField || 'title_t'] = 1; }
		else { fields[Solr.config.contentField || 'description_t'] = 1; }

		query = Solr.client.createQuery().q(data.query).dismax().qf(fields).start(0).rows(500);

		Solr.client.search(query, function(err, obj) {
			if (err) {
				return callback(err);
			} else if (obj && obj.response && obj.response.docs.length > 0) {
				var payload = obj.response.docs.map(function(result) {
						return result[field];
					}).filter(Boolean);

				callback(null, payload);
				cache.set(data.query, payload);
			} else {
				callback(null, []);
				cache.set(data.query, []);
			}

			winston.verbose('[plugin/solr] Search (' + data.index + ') for "' + data.query + '" returned ' + obj.response.docs.length + ' results');
		});
	}
};

Solr.searchTopic = function(data, callback) {
	var tid = data.tid,
		term = data.term;

	if (!term || !term.length) {
		return callback(null, []);
	}

	topics.getPids(tid, function(err, pids) {
		var fields = {},
			query;

		pids = pids.map(function(pid) { return '"post:' + pid + '"'; });

		// Populate Query
		fields[Solr.config.contentField || 'description_t'] = escapeSpecialChars(term);
		fields.id = '(' + pids.join(' OR ') + ')';

		query = Solr.client.createQuery().q(fields);

		Solr.client.search(query, function(err, obj) {
			if (err) {
				callback(err);
			} else if (obj && obj.response && obj.response.docs.length > 0) {
				callback(null, obj.response.docs.map(function(result) {
					return result.pid_i;
				}));
			} else {
				callback(null, []);
			}
		});
	});
};

Solr.toggle = function(req, res) {
	if (req.body.state) {
		db.setObjectField('settings:solr', 'enabled', parseInt(req.body.state, 10) ? '1' : '0', function(err) {
			Solr.config.enabled = req.body.state;
			res.sendStatus(!err ? 200 : 500);
		});
	} else {
		res.status(400).send('"state" required');
	}
};

Solr.add = function(payload, callback) {
	async.series([
		function(next) {
			Solr.client.add(payload, next);
		},
		async.apply(Solr.commit)
	], function(err) {
		if (err) {
			winston.error('[plugins/solr] Could not index post ' + payload.id + ', error: ' + err.message);
		} else if (typeof callback === 'function') {
			callback.apply(arguments);
		}
	});
};

Solr.remove = function(key) {
	async.series([
		function(next) {
			Solr.client.delete('id', key, next);
		},
		async.apply(Solr.commit)
	], function(err) {
		if (err) {
			winston.error('[plugins/solr] Could not remove ' + key + ' from index');
		}
	});
};

Solr.commit = function(callback) {
	Solr.client.commit(callback);
};

Solr.flush = function(req, res) {
	async.series([
		function(next) {
			Solr.client.deleteAll(next);
		},
		async.apply(Solr.commit)
	], function(err) {
		if (err) {
			winston.error('[plugins/solr] Could not empty the search index');
			res.status(500).send(err.message);
		} else {
			res.sendStatus(200);
		}
	});
};

Solr.post = {};
Solr.post.save = function(postData) {
	if (!parseInt(Solr.config.enabled, 10)) {
		return;
	}

	Solr.indexPost(postData);
};

Solr.post.delete = function(pid, callback) {
	if (!parseInt(Solr.config.enabled, 10)) {
		return;
	}

	Solr.remove('post:' + pid);

	if (typeof callback === 'function') {
		if (!parseInt(Solr.config.enabled, 10)) {
			return;
		}

		callback();
	}
};

Solr.post.restore = Solr.post.save;
Solr.post.edit = Solr.post.save;

Solr.topic = {};
Solr.topic.post = function(topicObj) {
	if (!parseInt(Solr.config.enabled, 10)) {
		return;
	}

	Solr.indexTopic(topicObj);
};

Solr.topic.delete = function(tid) {
	if (!parseInt(Solr.config.enabled, 10)) {
		return;
	}

	Solr.deindexTopic(tid);
};

Solr.topic.restore = Solr.topic.post;

Solr.topic.edit = function(topicObj) {
	if (!parseInt(Solr.config.enabled, 10)) {
		return;
	}

	async.waterfall([
		async.apply(posts.getPostFields,topicObj.mainPid, ['pid', 'content']),
		Solr.indexPost,
	], function(err, payload) {
		if (err) {
			return winston.error(err.message);
		}
		if (!payload) {
			return winston.warn('[solr] no payload for pid ' + topicObj.mainPid);
		}

		payload[Solr.config.titleField || 'title_t'] = topicObj.title;
		Solr.add(payload);
	});
};

/* Topic and Post indexing methods */

Solr.indexTopic = function(topicObj, callback) {
	async.waterfall([
		async.apply(topics.getPids, topicObj.tid),
		function(pids, next) {
			posts.getPostsFields(pids, ['pid', 'content'], next);
		},
		function(posts, next) {
			winston.verbose('[plugins/solr] Indexing tid ' + topicObj.tid + ' (' + posts.length + ' posts)');
			async.map(posts, Solr.indexPost, next);
		}
	], function(err, payload) {
		if (err) {
			winston.error('[plugins/solr] Encountered an error while compiling post data for tid ' + topicObj.tid);

			if (typeof callback === 'function') {
				return callback(err);
			}
		}

		payload = payload.filter(Boolean);

		// Also index the title
		var titleObj = {
				id: 'topic:' + topicObj.tid,	// Just needs to be unique
				'tid_i': topicObj.tid,
			};
		titleObj[Solr.config.titleField || 'title_t'] = topicObj.title;

		payload.push(titleObj);

		// Increment counter for index status
		if (Solr.indexStatus.running) { Solr.indexStatus.current++; }

		if (typeof callback === 'function') {
			callback(undefined, payload);
		} else {
			Solr.add(payload, callback);
		}
	});
};

Solr.deindexTopic = function(tid) {
	topics.getPids(tid, function(err, pids) {
		var query = 'id:(' + pids.join(' OR ') + ')';
		Solr.client.deleteByQuery(query, function(err) {
			if (err) {
				winston.error('[plugins/solr] Encountered an error while deindexing tid ' + tid);
			}
		});
	});
};

Solr.indexPost = function(postData, callback) {
	if (!postData || !postData.pid || !postData.content) {
		return callback(null);
	}

	var payload = {
			id: 'post:' + postData.pid,	// Just needs to be unique
			'pid_i': postData.pid
		};

	payload[Solr.config.contentField || 'description_t'] = postData.content;

	if (typeof callback === 'function') {
		callback(undefined, payload);
	} else {
		Solr.add(payload);
	}

};

Solr.deindexPost = Solr.post.delete;

Solr.rebuildIndex = function(req, res) {
	if (Solr.indexStatus.running) {
		winston.warn('[plugins/solr] Solr is already indexing...');
		return res.sendStatus(400);
	} else {
		res.sendStatus(200);
	}

	async.waterfall([
		async.apply(db.getSortedSetRange, 'topics:tid', 0, -1),
		function(tids, next) {
			Solr.indexStatus.running = true;
			Solr.indexStatus.current = 0;
			Solr.indexStatus.total = tids.length;

			topics.getTopicsFields(tids, ['tid', 'mainPid', 'title'], next);
		}
	], function(err, topics) {
		if (err) {
			winston.error('[plugins/solr] Could not retrieve topic listing for indexing. Error: ' + err.message);
		}

		async.mapLimit(topics, 100, Solr.indexTopic, function(err, topicPayloads) {
			if (err) {
				winston.error('[plugins/solr] Could not retrieve topic listing for indexing. Error: ' + err.message);
			}

			// Normalise and validate the entries before they're added to Solr
			var payload = topicPayloads.reduce(function(currentPayload, topics) {
					if (Array.isArray(topics)) {
						return currentPayload.concat(topics);
					} else {
						currentPayload.push(topics);
					}
				}, []).filter(function(entry) {
					return entry.hasOwnProperty('id');
				});

			Solr.add(payload, function(err) {
				if (!err) {
					winston.info('[plugins/solr] Re-indexing completed.');
					Solr.indexStatus.running = false;
				} else {
					winston.error('[plugins/solr] Could not retrieve topic listing for indexing. Error: ' + err.message);
				}
			});
		});
	});
};

Solr.getIndexProgress = function(req, res) {
	if (Solr.indexStatus.running && Solr.indexStatus.total > 0) {
		var progress = (Solr.indexStatus.current / Solr.indexStatus.total).toFixed(4) * 100;
		res.status(200).send(progress.toString());
	} else {
		res.status(200).send('-1');
	}
};

module.exports = Solr;
