var	Solr = module.parent.exports,
	async = module.parent.parent.require('async'),

	Middleware = {};

Middleware.ping = function(req, res, next) {
	Solr.ping(function(err, response) {
		res.locals.ping = !err ? response : undefined;
		next();
	});
};

Middleware.getEnabled = function(req, res, next) {
	res.locals.enabled = parseInt(Solr.config.enabled, 10) || false;
	next();
};

Middleware.getStats = function(req, res, next) {
	async.parallel({
		count: async.apply(Solr.getRecordCount),
		topics: async.apply(Solr.getTopicCount)
	}, function(err, data) {
		if (!err) {
			res.locals.stats = {
				total: data.count,
				topics: data.topics
			};
		}

		next();
	});
};

module.exports = Middleware;