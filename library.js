"use strict";

/* globals module, require */

var db = module.parent.require('./database'),
	winston = module.parent.require('winston'),
	engine = require('solr-client'),
	async = module.parent.require('async'),

	topics = module.parent.require('./topics'),
	posts = module.parent.require('./posts'),

	Solr = {
		config: {},	// default is localhost:8983, '' core, '/solr' path
		client: undefined
	};

Solr.init = function(app, middleware, controllers, callback) {
	var pluginMiddleware = require('./middleware'),
		render = function(req, res, next) {
			res.render('admin/plugins/solr', {
				ping: res.locals.ping,
				stats: res.locals.stats
			});
		};

	app.get('/admin/plugins/solr', middleware.admin.buildHeader, pluginMiddleware.ping, pluginMiddleware.getStats, render);
	app.get('/api/admin/plugins/solr', pluginMiddleware.ping, pluginMiddleware.getStats, render);

	// Utility
	app.post('/admin/plugins/solr/rebuild', middleware.admin.isAdmin, Solr.rebuildIndex);
	app.delete('/admin/plugins/solr/flush', middleware.admin.isAdmin, Solr.flush);

	Solr.getSettings(Solr.connect);

	callback();
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

// Solr.commit = function(callback) {
// 	Solr.client.commit(function(err, obj) {
// 		if (err) {
// 			winston.error('[plugins/solr] Could not commit changes to the index');
// 		}

// 		winston.info('[plugins/solr] Committing to index');
// 		if (typeof callback === 'function') {
// 			callback.apply(arguments);
// 		}
// 	});
// };

Solr.flush = function(req, res) {
	Solr.client.delete('id','*', function (err, obj){
		if (err) {
			winston.error('[plugins/solr] Could not empty the search index');
			res.send(500, err.message);
		} else {
			res.send(200);
		}
	});
};

Solr.getById = function(id, callback) {
	var	query = Solr.client.createQuery().q(id).dismax().qf({
			id: 1
		}).rows(1);

	Solr.client.search(query, function(err, obj) {
		if (!err && obj.response.docs.length > 0) {
			callback(null, obj.response.docs[0]);
		} else {
			callback(null, {});
		}
	});
};

Solr.post = {};
Solr.post.save = function(postData) {
	Solr.add({
		id: postData.pid,
		description_t: postData.content
	});
};

Solr.post.delete = function(pid, callback) {
	Solr.remove(pid);

	if (typeof callback === 'function') {
		callback();
	}
};

Solr.post.restore = function(postData) {
	Solr.add({
		id: postData.pid,
		description_t: postData.content
	});
};

Solr.post.edit = Solr.post.restore;

Solr.topic = {};
Solr.topic.post = function(topicObj) {
	Solr.add({
		id: topicObj.mainPid,
		title_t: topicObj.title
	});
};

Solr.topic.delete = function(tid) {
	topics.getTopicField(tid, 'mainPid', function(err, mainPid) {
		Solr.remove(mainPid);
	});
};

Solr.topic.restore = function(tid) {
	topics.getTopicFields(tid, ['mainPid', 'title'], function(err, topicData) {
		posts.getPostField(topicData.mainPid, 'content', function(err, content) {
			Solr.add({
				id: topicData.mainPid,
				title_t: topicData.title,
				description_t: content
			});
		});
	});
};

Solr.topic.edit = function(tid) {
	topics.getTopicFields(tid, ['mainPid', 'title'], function(err, topicData) {
		Solr.add({
			id: topicData.mainPid,
			title_t: topicData.title
		});
	});
};

/* Topic and Post indexing methods */

Solr.indexTopic = function(tid, callback) {
	async.parallel({
		topic: async.apply(topics.getTopicFields, tid, ['title', 'mainPid']),
		pids: async.apply(topics.getPids, tid)
	}, function(err, data) {
		// Solr.add({
		// 	id: data.topic.mainPid,
		// 	title_t: data.topic.title
		// }, true);

		// Add OP to the list of pids to index
		if (data.topic.mainPid) {
			data.pids.unshift(data.topic.mainPid);
		}

		async.map(data.pids, Solr.indexPost, function(err, payload) {
			if (err) {
				winston.error('[plugins/solr] Encountered an error while compiling post data for tid ' + tid);
				if (callback) callback(err);
			} else if (typeof callback === 'function') {
				callback(undefined, payload);
			} else {
				Solr.add(payload, callback);
			}
		});
	});
};

Solr.deindexTopic = function(tid) {

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