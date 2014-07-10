var	Solr = module.parent.exports,

	Middleware = {};

Middleware.ping = function(req, res, next) {
	Solr.client.ping(function(err, response) {
		res.locals.ping = !err ? response : undefined;
		next();
	});
};

Middleware.getStats = function(req, res, next) {
	Solr.getRecordCount(function(err, count) {
		if (!err) {
			res.locals.stats = {
				total: count
			};
		}

		next();
	});
};

module.exports = Middleware;