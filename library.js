"use strict";

var db = module.parent.require('./database'),
	engine = require('solr-client'),

	Solr = {
		config: {},	// default is localhost:8983, '' core, '/solr' path
		client: undefined
	};

Solr.init = function(app, middleware, controllers) {
	var pluginMiddleware = require('./middleware'),
		render = function(req, res, next) {
			res.render('admin/plugins/solr', {
				ping: res.locals.ping
			});
		};

	app.get('/admin/plugins/solr', middleware.admin.buildHeader, pluginMiddleware.ping, render);
	app.get('/api/admin/plugins/solr', pluginMiddleware.ping, render);

	Solr.getSettings(Solr.connect);
};

Solr.getSettings = function(callback) {
	db.getObject('solr:config', function(err, config) {
		if (!err) {
			for(var k in config) {
				if (config.hasOwnProperty(k) && !Solr.config.hasOwnProperty(k)) {
					Solr.config = config[k];
				}
			}
		} else {
			winston.error('[plugin:solr] Could not fetch settings, assuming defaults.');
		}

		callback();
	});
};

Solr.connect = function() {
	Solr.client = engine.createClient(Solr.config);
};

Solr.adminMenu = function(custom_header, callback) {
	custom_header.plugins.push({
		"route": '/plugins/solr',
		"icon": 'fa-search',
		"name": 'Apache Solr'
	});

	callback(null, custom_header);
};

module.exports = Solr;