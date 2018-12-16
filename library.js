'use strict';

/* globals module, require */

const db = require.main.require('./src/database');
const winston = require.main.require('winston');
const engine = require('solr-client');
const async = require.main.require('async');

const LRU = require('lru-cache');
const titleCache = LRU({ max: 20, maxAge: 1000 * 60 * 20 });	// Remember the last 20 searches in the past twenty minutes
const postCache = LRU({ max: 20, maxAge: 1000 * 60 * 20 });	// Remember the last 20 searches in the past twenty minutes

const topics = require.main.require('./src/topics');
const posts = require.main.require('./src/posts');
const batch = require.main.require('./src/batch');
const utils = require('./lib/utils');

const Solr = {
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
		total: 0,
		message: 'Initializing',
	},
};

Solr.init = function (data, callback) {
	const pluginMiddleware = require('./middleware');
	const render = function (req, res) {
		// Regenerate csrf token
		const token = req.csrfToken();

		res.render('admin/plugins/solr', {
			ping: res.locals.ping,
			enabled: res.locals.enabled,
			stats: res.locals.stats,
			csrf: token,
			running: Solr.indexStatus.running,
		});
	};

	data.router.get('/admin/plugins/solr', data.middleware.applyCSRF, data.middleware.admin.buildHeader, pluginMiddleware.ping, pluginMiddleware.getEnabled, pluginMiddleware.getStats, render);
	data.router.get('/api/admin/plugins/solr', data.middleware.applyCSRF, pluginMiddleware.ping, pluginMiddleware.getEnabled, pluginMiddleware.getStats, render);

	// Utility
	data.router.post('/admin/plugins/solr/rebuild', Solr.rebuildIndex);
	data.router.get('/admin/plugins/solr/rebuildProgress', Solr.getIndexProgress);
	data.router.post('/admin/plugins/solr/toggle', Solr.toggle);
	data.router.delete('/admin/plugins/solr/flush', Solr.flush);
	data.router.delete('/admin/plugins/solr/cache', Solr.dropCaches);

	Solr.getSettings(Solr.connect);

	callback();
};

Solr.ping = function (callback) {
	if (Solr.client) {
		Solr.client.ping(callback);
	} else {
		callback(new Error('not-connected'));
	}
};

Solr.checkConflict = function () {
	return !!module.parent.exports.libraries['nodebb-plugin-dbsearch'];
};

Solr.getNotices = function (notices, callback) {
	Solr.ping(function (err) {
		const solrNotices = [
			{ done: !err, doneText: 'Solr connection OK', notDoneText: 'Could not connect to Solr server' },
			{ done: parseInt(Solr.config.enabled, 10) || false, doneText: 'Solr Indexing Enabled', notDoneText: 'Solr Indexing Disabled' },
		];

		callback(null, notices.concat(solrNotices));
	});
};

Solr.getSettings = function (callback) {
	db.getObject('settings:solr', function (err, config) {
		Solr.config = {};
		if (!err) {
			for (const k in config) {
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

Solr.getRecordCount = function (callback) {
	const query = Solr.client.createQuery().q('*:*').start(0).rows(0);

	Solr.client.search(query, function (err, obj) {
		if (!err && obj && obj.response) {
			callback(undefined, obj.response.numFound);
		} else {
			callback(err, 0);
		}
	});
};

Solr.getTopicCount = function (callback) {
	const query = Solr.client.createQuery().q((Solr.config.titleField || 'title_t') + ':*').start(0).rows(0);

	Solr.client.search(query, function (err, obj) {
		if (!err && obj && obj.response) {
			callback(undefined, obj.response.numFound);
		} else {
			callback(err, 0);
		}
	});
};

Solr.connect = function () {
	if (Solr.client) {
		delete Solr.client;
	}

	Solr.client = engine.createClient(Solr.config);

	if (Solr.config.username && Solr.config.password) {
		Solr.client.basicAuth(Solr.config.username, Solr.config.password);
	}
};

Solr.adminMenu = function (custom_header, callback) {
	custom_header.plugins.push({
		route: '/plugins/solr',
		icon: 'fa-search',
		name: 'Apache Solr',
	});

	callback(null, custom_header);
};

Solr.search = function (data, callback) {
	if (Solr.checkConflict()) {
		// The dbsearch plugin was detected, abort search!
		winston.warn('[plugin/solr] Another search plugin (dbsearch) is enabled, so search via Solr was aborted.');
		return callback(null, data);
	}
	const isTopic = data.index === 'topic';
	const field = isTopic ? 'tid_i' : 'pid_i';
	const term = utils.addFiltersToTerm(data.content, data);

	// Determine which cache to use
	const cache = isTopic ? titleCache : postCache;

	if (cache.has(term)) {
		callback(null, cache.get(term));
	} else {
		const fields = {};

		// Populate Fields
		if (isTopic) { fields[Solr.config.titleField || 'title_t'] = 1; } else { fields[Solr.config.contentField || 'description_t'] = 1; }

		const query = Solr.client.createQuery().q(term).edismax().qf(fields).start(0).rows(500);

		Solr.client.search(query, function (err, obj) {
			if (err) {
				return callback(err);
			} else if (obj && obj.response && obj.response.docs.length > 0) {
				const payload = obj.response.docs.map(function (result) {
					return result[field];
				}).filter(Boolean);

				callback(null, payload);
				cache.set(term, payload);
			} else {
				callback(null, []);
				cache.set(term, []);
			}

			winston.verbose('[plugin/solr] Search (' + data.index + ') for "' + data.content + '" returned ' + obj.response.docs.length + ' results');
		});
	}
};

Solr.searchTopic = function (data, callback) {
	const tid = data.tid;
	const term = data.term;

	if (!term || !term.length) {
		return callback(null, []);
	}

	const fields = {};

	// Populate Query
	fields[Solr.config.contentField || 'description_t'] = term;
	fields.tid_i = tid;

	const query = Solr.client.createQuery().q(fields);

	Solr.client.search(query, function (err, obj) {
		if (err) {
			callback(err);
		} else if (obj && obj.response && obj.response.docs.length > 0) {
			callback(null, obj.response.docs.map(function (result) {
				return result.pid_i;
			}));
		} else {
			callback(null, []);
		}
	});
};

Solr.toggle = function (req, res) {
	if (req.body.state) {
		db.setObjectField('settings:solr', 'enabled', parseInt(req.body.state, 10) ? '1' : '0', function (err) {
			Solr.config.enabled = req.body.state;
			res.sendStatus(!err ? 200 : 500);
		});
	} else {
		res.status(400).send('"state" required');
	}
};

Solr.add = function (payload, callback) {
	async.series([
		function (next) {
			Solr.client.add(payload, next);
		},
		async.apply(Solr.commit),
	], function (err) {
		if (err) {
			winston.error('[plugins/solr] Could not index post ' + payload.id + ', error: ' + err.message);
		} else if (typeof callback === 'function') {
			callback.apply(arguments);
		}
	});
};

Solr.remove = function (key, callback) {
	Solr.client.delete('id', key, function (err) {
		if (err) {
			winston.error('[plugins/solr] Could not remove ' + key + ' from index');
		}

		if (typeof callback === 'function') {
			callback(err);
		} else {
			Solr.commit();
		}
	});
};

Solr.commit = function (callback) {
	Solr.client.commit(callback);
};

Solr.flush = function (req, res) {
	async.series([
		function (next) {
			Solr.client.deleteAll(next);
		},
		async.apply(Solr.commit),
	], function (err) {
		if (err) {
			winston.error('[plugins/solr] Could not empty the search index');
			res.status(500).send(err.message);
		} else {
			Solr.dropCaches();
			winston.verbose('[plugins/solr] Search index flushed!');
			res.sendStatus(200);
		}
	});
};

Solr.dropCaches = function (req, res) {
	postCache.reset();
	titleCache.reset();

	if (res && res.sendStatus) {
		res.sendStatus(200);
	}
};

Solr.post = {};
Solr.post.save = function (data) {
	if (!parseInt(Solr.config.enabled, 10)) {
		return;
	}

	Solr.indexPost(data.post);
};

Solr.post.delete = function (data, callback) {
	if (!parseInt(Solr.config.enabled, 10)) {
		return;
	}

	Solr.remove('post:' + data.post.pid);

	if (typeof callback === 'function') {
		if (!parseInt(Solr.config.enabled, 10)) {
			return;
		}

		callback();
	}
};

Solr.post.restore = Solr.post.save;
Solr.post.edit = Solr.post.save;

Solr.post.move = function (payload) {
	async.parallel({
		postData: async.apply(posts.getPostFields, payload.post.pid, ['pid', 'content', 'uid']),
		cid: async.apply(posts.getCidByPid, payload.post.pid),
	}, function (err, metadata) {
		if (err) {
			winston.error('[plugins/solr] Could not retrieve base data for post move');
		}

		metadata.postData.cid = metadata.cid;
		Solr.indexPost(metadata.postData);
	});
};

Solr.topic = {};
Solr.topic.post = function (data) {
	if (!parseInt(Solr.config.enabled, 10)) {
		return;
	}

	Solr.indexTopic(data.topic);
};

Solr.topic.delete = function (data) {
	const topicObj = data.topic;
	const tid = (undefined === topicObj.tid) ? topicObj : topicObj.tid;
	if (!parseInt(Solr.config.enabled, 10)) {
		return;
	}

	Solr.deindexTopic(tid);
};

Solr.topic.restore = Solr.topic.post;

Solr.topic.edit = function (data) {
	const topicObj = data.topic;

	if (!parseInt(Solr.config.enabled, 10)) {
		return;
	}

	async.waterfall([
		async.apply(posts.getPostFields, topicObj.mainPid, ['pid', 'tid', 'uid', 'content']),
		Solr.indexPost,
	], function (err, payload) {
		if (err) {
			return winston.error(err.message);
		}
		if (!payload) {
			return winston.warn('[solr] no payload for pid ' + topicObj.mainPid);
		}

		payload[Solr.config.titleField || 'title_t'] = topicObj.title;
		payload = [payload];
		payload.push({
			id: 'topic:' + topicObj.tid,
			tid_i: topicObj.tid,
			cid_i: topicObj.cid,
			uid_i: topicObj.uid,
			title_t: topicObj.title,
		});
		Solr.add(payload);
	});
};

Solr.topic.move = function (data) {
	if (!parseInt(Solr.config.enabled, 10)) {
		return;
	}

	async.waterfall([
		async.apply(Solr.deindexTopic, data.tid),
		async.apply(topics.getTopicFields, data.tid, ['tid', 'mainPid', 'title', 'cid', 'uid']),
		async.apply(Solr.indexTopic),
		async.apply(Solr.add),
	], function (err) {
		if (!err) {
			winston.verbose('[plugins/solr] tid ' + data.tid + ' moved, index updated');
		}
	});
};

/* Topic and Post indexing methods */

Solr.indexTopic = function (topicObj, callback) {
	if (topicObj.hasOwnProperty('deleted') && parseInt(topicObj.deleted, 10) === 1) {
		callback = callback || function () {};
		return callback();
	}

	async.waterfall([
		async.apply(topics.getPids, topicObj.tid),
		function (pids, next) {
			posts.getPostsFields(pids, ['pid', 'tid', 'content', 'uid'], function (err, posts) {
				if (err) {
					return next(err);
				}

				next(null, posts.map(function (post) {
					post.cid = topicObj.cid;
					return post;
				}));
			});
		},
		function (posts, next) {
			winston.verbose('[plugins/solr] Indexing tid ' + topicObj.tid + ' (' + posts.length + ' posts)');
			async.map(posts, Solr.indexPost, next);
		},
	], function (err, payload) {
		if (err) {
			winston.error('[plugins/solr] Encountered an error while compiling post data for tid ' + topicObj.tid);

			if (typeof callback === 'function') {
				return callback(err);
			}
		}

		payload = payload.filter(Boolean);

		// Also index the title
		const titleObj = {
			id: 'topic:' + topicObj.tid,	// Just needs to be unique
			tid_i: topicObj.tid,
			cid_i: topicObj.cid,
			uid_i: topicObj.uid,
		};
		titleObj[Solr.config.titleField || 'title_t'] = topicObj.title;

		payload.push(titleObj);

		// Increment counter for index status
		if (Solr.indexStatus.running) { Solr.indexStatus.current += 1; }

		if (typeof callback === 'function') {
			callback(undefined, payload);
		} else {
			Solr.add(payload);
		}
	});
};

Solr.deindexTopic = function (tid, callback) {
	topics.getPids(tid, function (err, pids) {
		if (err) {
			winston.error('[plugins/solr] Could not retrieve pids for deindex');
			return callback(err);
		}

		const commands = [
			async.apply(Solr.remove, 'topic:' + tid),
		];
		for (let x = 0, numPids = pids.length; x < numPids; x++) {
			commands.push(async.apply(Solr.remove, 'post:' + pids[x]));
		}
		commands.push(async.apply(Solr.commit));

		async.series(commands, function (err) {
			if (err) {
				winston.error('[plugins/solr] Encountered an error while deindexing tid ' + tid);
			} else {
				winston.verbose('[plugins/solr] Removed tid ' + tid + ' from index');
			}

			if (typeof callback === 'function') {
				callback(err);
			}
		});
	});
};

Solr.indexPost = function (postData, callback) {
	if (!postData || !postData.pid || !postData.content) {
		if (typeof callback === 'function') {
			callback(null);
		}

		return;
	}

	const payload = {
		id: 'post:' + postData.pid,	// Just needs to be unique
		pid_i: postData.pid,
		tid_i: postData.tid,
		cid_i: postData.cid,
		uid_i: postData.uid,
	};

	payload[Solr.config.contentField || 'description_t'] = postData.content;

	if (typeof callback === 'function') {
		callback(undefined, payload);
	} else {
		Solr.add(payload);
	}
};

Solr.deindexPost = Solr.post.delete;

Solr.rebuildIndex = function (req, res) {
	if (Solr.indexStatus.running) {
		winston.warn('[plugins/solr] Solr is already indexing...');
		return res.sendStatus(400);
	}
	res.sendStatus(200);


	Solr.indexStatus.running = true;
	Solr.indexStatus.current = 0;
	Solr.indexStatus.message = 'Initializing';

	async.series({
		total: function (next) {
			async.parallel({
				topics: async.apply(db.sortedSetCount, 'topics:tid', 0, Date.now()),
			}, function (err, results) {
				if (err) {
					return next(err);
				}

				Solr.indexStatus.total = results.topics;
				next();
			});
		},
		topics: async.apply(Solr.rebuildTopicIndex),
	}, function (err, results) {
		if (!err) {
			Solr.add(results.topics, function (err) {
				if (!err) {
					winston.info('[plugins/solr] Re-indexing completed.');
					Solr.indexStatus.message = 'Indexing finished';
					Solr.indexStatus.running = false;
				} else {
					winston.error('[plugins/solr] Unable to add final data to solr. Error: ' + err.message);
				}
			});
		} else {
			winston.error('[plugins/solr] Could not retrieve topic listing for indexing. Error: ' + err.message);
		}
	});
};

Solr.rebuildTopicIndex = function (callback) {
	Solr.indexStatus.message = 'Collecting topic metadata';

	async.waterfall([
		async.apply(db.sortedSetCount, 'topics:tid', '-inf', '+inf'),
		function (topicsCount, next) {
			let topicsFields = [];
			let metadataCollected = 0;
			Solr.indexStatus.message = 'Collecting topic metadata 0 / ' + topicsCount;
			batch.processSortedSet('topics:tid', function (tids, callback) {
				topics.getTopicsFields(tids, ['tid', 'mainPid', 'title', 'cid', 'uid', 'deleted'], function (err, results) {
					if (!err) {
						topicsFields = topicsFields.concat(results);
						metadataCollected += results.length;
						Solr.indexStatus.message = 'Collecting topic metadata ' + metadataCollected + ' / ' + topicsCount;
					}

					callback(err);
				});
			}, function (err) {
				if (err) {
					winston.error('[plugins/solr/reindexTopic] Could not retrieve topic listing for indexing. Error: ' + err.message);
				}

				next(err, topicsFields);
			});
		},
		function (topics, next) {
			Solr.indexStatus.message = 'Indexed topics 0 / ' + topics.length;

			let indexedTopicCount = 0;
			async.whilst(
				function () {
					return indexedTopicCount < topics.length;
				},
				function (callback) {
					const indexingTopics = topics.slice(indexedTopicCount, indexedTopicCount + 1000);
					async.mapLimit(indexingTopics, 100, Solr.indexTopic, function (err, topicPayloads) {
						if (err) {
							winston.error('[plugins/solr/reindexTopic] Could not retrieve topic content for indexing. Error: ' + err.message);
							return callback(err);
						}

						// Normalise and validate the entries before they're added to Solr
						const payload = topicPayloads.reduce(function (currentPayload, topics) {
							if (Array.isArray(topics)) {
								return currentPayload.concat(topics);
							}
							currentPayload.push(topics);
							return currentPayload;
						}, []).filter(function (entry) {
							return entry && entry.hasOwnProperty('id');
						});

						indexedTopicCount += indexingTopics.length;
						Solr.indexStatus.message = 'Indexed topics ' + indexedTopicCount + ' / ' + topics.length;

						Solr.add(payload, function (err) {
							if (!err) {
								const progressPercent = (100 * indexedTopicCount / topics.length).toFixed(2);
								winston.info('[plugins/solr/reindexTopic] Partial re-indexing completed: ' + progressPercent + '%');
							}

							callback(err);
						});
					});
				},
				next);
		},
	],
	function (err) {
		if (typeof callback === 'function') {
			callback(err, []);
		} else if (!err) {
			winston.info('[plugins/solr/reindexTopic] Topic re-indexing completed.');
		} else {
			winston.error('[plugins/solr/reindexTopic] Could not insert data into Solr for indexing. Error: ' + err.message);
		}
	});
};

Solr.getIndexProgress = function (req, res) {
	if (Solr.indexStatus.running) {
		if (Solr.indexStatus.total > 0) {
			const progress = (Solr.indexStatus.current / Solr.indexStatus.total).toFixed(4) * 100;
			res.status(200).send({
				percentage: progress,
				message: Solr.indexStatus.message,
			});
		} else {
			res.status(200).send({
				percentage: 0,
				message: Solr.indexStatus.message,
			});
		}
	} else {
		res.status(200).send({
			percentage: -1,
			message: 'Done',
		});
	}
};

module.exports = Solr;
