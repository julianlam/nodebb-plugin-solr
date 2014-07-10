"use strict";

var db = module.parent.require('./database'),
	winston = module.parent.require('winston'),
	engine = require('solr-client'),

	topics = module.parent.require('./topics'),
	posts = module.parent.require('./posts'),

	Solr = {
		config: {},	// default is localhost:8983, '' core, '/solr' path
		client: undefined
	};

Solr.init = function(app, middleware, controllers) {
	var pluginMiddleware = require('./middleware'),
		render = function(req, res, next) {
			res.render('admin/plugins/solr', {
				ping: res.locals.ping,
				stats: res.locals.stats
			});
		};

	app.get('/admin/plugins/solr', middleware.admin.buildHeader, pluginMiddleware.ping, pluginMiddleware.getStats, render);
	app.get('/api/admin/plugins/solr', pluginMiddleware.ping, pluginMiddleware.getStats, render);

	Solr.getSettings(Solr.connect);
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
	var query = Solr.client.createQuery()
			.q('*:*')
			.dismax()
			.start(0)
			.rows(0);

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
	var qf = data.index === 'topic' ? { title_t: 1 } : { description_t: 1 },
		query = Solr.client.createQuery()
			.q(data.query)
			.dismax()
			.qf(qf)
			.start(0)
			.rows(20);

	Solr.client.search(query, function(err, obj) {
		// ok reached a natural stopping point here.
		// NodeBB search calls this method twice, once for topic and once for post... but the search page only lists 1 set of results? I am confused.
		if (obj.response.docs.length > 0) {
			callback(null, obj.response.docs.map(function(result) {
				return result.id.split(':')[1];
			}));
		} else {
			callback(null, []);
		}
	});
};

Solr.post = {};
Solr.post.save = function(postData) {
	Solr.client.add({
		id: 'post:' + postData.pid,
		description_t: postData.content
	}, function(err, obj) {
		if (err) {
			winston.error('[plugins/solr] Could not index post ' + postData.pid);
		}
	});
};

Solr.post.delete = function() {
	console.log(arguments);
};

Solr.post.restore = function() {
	console.log(arguments);
};

Solr.post.edit = function() {
	console.log(arguments);
};

Solr.topic = {};
Solr.topic.save = function(tid) {
	topics.getTopicData(tid, function(err, topicObj) {
		console.log(arguments);
	});
};

Solr.topic.delete = function() {
	console.log(arguments);
};

Solr.topic.restore = function() {
	console.log(arguments);
};

Solr.topic.edit = function() {
	console.log(arguments);
};

module.exports = Solr;