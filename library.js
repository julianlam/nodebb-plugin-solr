"use strict";

/* globals module, require */

var db = module.parent.require('./database'),
	winston = module.parent.require('winston'),
	engine = require('solr-client'),
	async = module.parent.require('async'),

	topics = module.parent.require('./topics'),
	posts = module.parent.require('./posts'),

	// This method is necessary until solr-client 0.3.x is released
	escapeSpecialChars = function(s) {
		return s.replace(/([\+\-&\|!\(\)\{\}\[\]\^"~\*\?:\\\ ])/g, function(match) {
			return '\\' + match;
		});
	},

	Solr = {
		config: {},	// default is localhost:8983, '' core, '/solr' path
		client: undefined
	};

Solr.init = function(app, middleware, controllers, callback) {
	var pluginMiddleware = require('./middleware'),
		render = function(req, res, next) {
			// Regenerate csrf token
			var token = req.csrfToken();

			res.render('admin/plugins/solr', {
				ping: res.locals.ping,
				enabled: res.locals.enabled,
				stats: res.locals.stats,
				csrf: token
			});
		};

	app.get('/admin/plugins/solr', middleware.admin.buildHeader, pluginMiddleware.ping, pluginMiddleware.getEnabled, pluginMiddleware.getStats, render);
	app.get('/api/admin/plugins/solr', pluginMiddleware.ping, pluginMiddleware.getEnabled, pluginMiddleware.getStats, render);

	// Utility
	app.post('/admin/plugins/solr/rebuild', middleware.admin.isAdmin, Solr.rebuildIndex);
	app.post('/admin/plugins/solr/toggle', Solr.toggle);
	app.delete('/admin/plugins/solr/flush', middleware.admin.isAdmin, Solr.flush);

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
		if (!err) {
			callback(undefined, obj.response.numFound);
		} else {
			callback(err);
		}
	});
};

Solr.getTopicCount = function(callback) {
	var query = Solr.client.createQuery().q('title_t:*').start(0).rows(0);

	Solr.client.search(query, function(err, obj) {
		if (!err) {
			callback(undefined, obj.response.numFound);
		} else {
			callback(err);
		}
	});
}

Solr.onConfigChange = function(hash) {
	if (hash === 'settings:solr') {
		Solr.getSettings(Solr.connect);
	}
};

Solr.connect = function() {
	if (Solr.client) {
		delete Solr.client;
	}

	Solr.client = engine.createClient(Solr.config);
	Solr.client.autoCommit = true;
};

Solr.adminMenu = function(custom_header, callback) {
	custom_header.plugins.push({
		"route": '/plugins/solr',
		"icon": 'fa-search',
		"name": 'Apache Solr'
	});

	callback(null, custom_header);
};

Solr.search = function(data, callback) {
	if (Solr.checkConflict()) {
		// The dbsearch plugin was detected, abort search!
		winston.warn('[plugin/solr] Another search plugin (dbsearch) is enabled, so search via Solr was aborted.');
		return callback(null, data);
	} else if (data.index === 'topic') {
		// We are only using the "post" index, because Solr does its own relevency sorting
		return callback(null, []);
	}

	winston.info('[plugin/solr] Conducting search for: "' + data.query + '"');

	var query = Solr.client.createQuery().q(data.query).dismax().qf({
			title_t: 1.5,
			description_t: 1
		}).start(0).rows(20);

	Solr.client.search(query, function(err, obj) {
		if (obj.response.docs.length > 0) {
			callback(null, obj.response.docs.map(function(result) {
				return result.id;
			}));
		} else {
			callback(null, []);
		}
	});
};

Solr.searchTopic = function(tid, term, callback) {
	async.parallel({
		mainPid: async.apply(topics.getTopicField, tid, 'mainPid'),
		pids: async.apply(topics.getPids, tid)
	}, function(err, data) {
		data.pids.unshift(data.mainPid);
		var query = Solr.client.createQuery().q({
				description_t: escapeSpecialChars(term),
				id: '(' + data.pids.join(' OR ') + ')'
			});

		Solr.client.search(query, function(err, obj) {
			if (obj.response.docs.length > 0) {
				callback(null, obj.response.docs.map(function(result) {
					return result.id;
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
			res.send(!err ? 200 : 500);
		});
	} else {
		res.send(400, "'state' required");
	}
};

Solr.add = function(payload, callback) {
	Solr.client.add(payload, function(err, obj) {
		if (err) {
			winston.error('[plugins/solr] Could not index post ' + payload.id + ', error: ' + err.message);
		} else if (typeof callback === 'function') {
			callback.apply(arguments);
		}
	});
};

Solr.remove = function(pid) {
	Solr.client.delete('id', pid, function(err, obj) {
		if (err) {
			winston.error('[plugins/solr] Could not remove post ' + pid + ' from index');
		}
	});
};

Solr.flush = function(req, res) {
	Solr.client.delete('id', '*', function(err, obj){
		if (err) {
			winston.error('[plugins/solr] Could not empty the search index');
			res.send(500, err.message);
		} else {
			res.send(200);
		}
	});
};

Solr.post = {};
Solr.post.save = function(postData) {
	if (!parseInt(Solr.config.enabled, 10)) {
		return;
	}

	Solr.add({
		id: postData.pid,
		description_t: postData.content
	});
};

Solr.post.delete = function(pid, callback) {
	if (!parseInt(Solr.config.enabled, 10)) {
		return;
	}

	Solr.remove(pid);

	if (typeof callback === 'function') {
		if (!parseInt(Solr.config.enabled, 10)) {
			return;
		}

		callback();
	}
};

Solr.post.restore = function(postData) {
	if (!parseInt(Solr.config.enabled, 10)) {
		return;
	}

	Solr.add({
		id: postData.pid,
		description_t: postData.content
	});
};

Solr.post.edit = Solr.post.restore;

Solr.topic = {};
Solr.topic.post = function(topicObj) {
	if (!parseInt(Solr.config.enabled, 10)) {
		return;
	}

	Solr.indexTopic(topicObj.tid);
};

Solr.topic.delete = function(tid) {
	if (!parseInt(Solr.config.enabled, 10)) {
		return;
	}

	Solr.deindexTopic(tid);
};

Solr.topic.restore = function(tid) {
	if (!parseInt(Solr.config.enabled, 10)) {
		return;
	}

	Solr.indexTopic(tid);
};

Solr.topic.edit = function(tid) {
	if (!parseInt(Solr.config.enabled, 10)) {
		return;
	}

	topics.getTopicFields(tid, ['mainPid', 'title'], function(err, topicData) {
		Solr.indexPost(topicData.mainPid, function(err, payload) {
			payload.title_t = topicData.title;
			Solr.add(payload);
		});
	});
};

/* Topic and Post indexing methods */

Solr.indexTopic = function(tid, callback) {
	async.parallel({
		topic: async.apply(topics.getTopicFields, tid, ['title', 'mainPid']),
		pids: async.apply(topics.getPids, tid)
	}, function(err, data) {
		// Add OP to the list of pids to index
		if (data.topic.mainPid) {
			data.pids.unshift(data.topic.mainPid);
		}

		async.map(data.pids, Solr.indexPost, function(err, payload) {
			if (err) {
				winston.error('[plugins/solr] Encountered an error while compiling post data for tid ' + tid);
				if (callback) callback(err);
			} else {
				// Also index the title into the main post of this topic
				for(var x=0,numPids=payload.length;x<numPids;x++) {
					if (payload[x].id === data.topic.mainPid) {
						payload[x].title_t = data.topic.title;
					}
				}

				if (typeof callback === 'function') {
					callback(undefined, payload);
				} else {
					Solr.add(payload, callback);
				}
			}
		});
	});
};

Solr.deindexTopic = function(tid) {
	async.parallel({
		mainPid: async.apply(topics.getTopicField, tid, 'mainPid'),
		pids: async.apply(topics.getPids, tid)
	}, function(err, data) {
		data.pids.unshift(data.mainPid);
		var query = 'id:(' + data.pids.join(' OR ') + ')';
		Solr.client.deleteByQuery(query, function(err, obj) {
			if (err) {
				winston.error('[plugins/solr] Encountered an error while deindexing tid ' + tid);
			}
		});
	});
};

Solr.indexPost = function(pid, callback) {
	posts.getPostField(pid, 'content', function(err, content) {
		if (typeof callback === 'function') {
			callback(undefined, {
				id: pid,
				description_t: content
			});
		} else {
			Solr.add({
				id: pid,
				description_t: content
			});
		}
	});
};

Solr.deindexPost = Solr.post.delete;

Solr.rebuildIndex = function(req, res) {
	db.getSortedSetRange('topics:tid', 0, -1, function(err, tids) {
		if (err) {
			winston.error('[plugins/solr] Could not retrieve topic listing for indexing');
		} else {
			async.map(tids, Solr.indexTopic, function(err, topicPayloads) {
				var payload = [];
				for(var x=0,numTopics=topicPayloads.length;x<numTopics;x++) {
					payload = payload.concat(topicPayloads[x]);
				}

				Solr.add(payload, function(err, obj) {
					if (!err) {
						res.send(200);
					}
				});
			});
		}
	});
};

module.exports = Solr;