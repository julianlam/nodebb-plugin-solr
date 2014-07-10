var	Solr = module.parent.exports,

	Middleware = {};

Middleware.ping = function(req, res, next) {
	Solr.client.ping(function(err, response) {
		res.locals.ping = !err ? response : undefined;
		next();
	});
};

module.exports = Middleware;