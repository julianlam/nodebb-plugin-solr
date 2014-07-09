"use strict";

var Solr = {};

Solr.init = function(app, middleware, controllers) {
	function render(req, res, next) {
		res.render('admin/plugins/solr', {});
	}

	app.get('/admin/plugins/solr', middleware.admin.buildHeader, render);
	app.get('/api/admin/plugins/solr', render);
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