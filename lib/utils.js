'use strict';
var utils = {};

utils.addFiltersToTerm = function(term, data) {
	var newTerm = term || '';
	if (data.uid && Array.isArray(data.uid) && data.uid.length) {
		newTerm += (newTerm.length ? ' AND ' : '') + '( ' + data.uid.map(function(uid) { return 'uid_i:' + uid; }).join(' OR ') + ' )';
	}

	if (data.cid && Array.isArray(data.cid) && data.cid.length) {
		newTerm += (newTerm.length ? ' AND ' : '') + '( ' + data.cid.map(function(cid) { return 'cid_i:' + cid; }).join(' OR ') + ' )';
	}

	return newTerm;
};

module.exports = utils;
