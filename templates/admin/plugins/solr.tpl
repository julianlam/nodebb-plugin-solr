<div class="row">
	<div class="col-lg-9">
		<div class="panel panel-default">
			<div class="panel-heading">Apache Solr</div>
			<div class="panel-body">
				<div class="alert alert-info">
					<p>
						<strong><i class="fa fa-warning"></i> Please Note</strong>
					</p>
					<p>
						By default, Solr is not secured against outside access. For the safety and integrity of
						your data, it is recommended that you maintain a firewall to close off public access
						to the Tomcat/Jetty server that is serving Solr. (On Ubuntu, the <code>ufw</code> utility
						works well). You can also elect to limit access to requests from the NodeBB server only.
					</p>
					<p>
						For more information: <a href="https://wiki.apache.org/solr/SolrSecurity">https://wiki.apache.org/solr/SolrSecurity</a>
					</p>
				</div>

				<h3>Client Configuration</h2>
				<form role="form" class="solr-settings">
					<div class="row">
						<div class="form-group col-sm-6">
							<label for="host">Host</label>
							<input class="form-control" type="text" name="host" id="host" placeholder="localhost" />
						</div>
						<div class="form-group col-sm-6">
							<label for="port">Port</label>
							<input class="form-control" type="text" name="port" id="port" placeholder="8983" />
						</div>
						<div class="form-group col-sm-6">
							<label for="path">Path</label>
							<input class="form-control" type="text" name="path" id="path" placeholder="/solr" />
						</div>
						<div class="form-group col-sm-6">
							<label for="core">Core</label>
							<input class="form-control" type="text" name="core" id="core" placeholder="" />
						</div>
					</div>

					<h4>Authentication</h3>
					<p class="help-block">
						If your Tomcat/Jetty server is configured with HTTP Basic Authentication, enter its credentials here.
						Leave it blank otherwise.
					</p>
					<div class="form-group col-sm-6">
						<label for="username">Username</label>
						<input class="form-control" type="text" name="username" id="username" />
					</div>
					<div class="form-group col-sm-6">
						<label for="password">Password</label>
						<input class="form-control" type="password" name="password" id="password" />
					</div>

					<h4>Custom Fields</h4>
					<div class="row">
						<div class="form-group col-xs-6">
							<label for="titleField">Title Field</label>
							<input class="form-control" type="text" placeholder="Default: title_t" id="titleField" name="titleField" />
						</div>
						<div class="form-group col-xs-6">
							<label for="contentField">Content Field</label>
							<input class="form-control" type="text" placeholder="Default: description_t" id="contentField" name="contentField" />
						</div>
						<p class="help-block col-xs-12">
							If you have specified your own field schema in your Solr <code>schema.xml</code>
							file, you an specify the custom fields here.
						</p>
					</div>
				</form>
			</div>
		</div>
	</div>
	<div class="col-lg-3">
		<div class="panel panel-default">
			<div class="panel-heading">Control Panel</div>
			<div class="panel-body">
				<button class="btn btn-primary" id="save">Save Settings</button>
			</div>
		</div>
		<div class="panel panel-default">
			<div class="panel-heading">
				<h3 class="panel-title">
					<!-- IF ping -->
					<i class="fa fa-circle text-success"></i> Connected
					<!-- ELSE -->
					<i class="fa fa-circle text-danger"></i> Not Connected
					<!-- ENDIF ping -->
				</h3>
			</div>
			<div class="panel-body">
				<!-- IF ping -->
				<p>
					NodeBB has successfully connected to the Solr search engine.
				</p>
				<!-- ELSE -->
				<p>
					NodeBB could not establish a connection to the Solr search engine.
				</p>
				<p>
					Please ensure your configuration settings are correct.
				</p>
				<!-- ENDIF ping -->

				<!-- IF enabled -->
				<button class="btn btn-success btn-block" data-action="toggle" data-enabled="1"><i class="fa fa-fw fa-play"></i> &nbsp; Indexing Enabled</button>
				<p class="help-block">
					Topics and Posts will be automatically added to the search index.
				</p>
				<!-- ELSE -->
				<button class="btn btn-warning btn-block" data-action="toggle" data-enabled="0"><i class="fa fa-fw fa-pause"></i> &nbsp; Indexing Disabled</button>
				<p class="help-block">
					Indexing is currently paused, Topics and Posts will not be automatically added to the search index.
				</p>
				<!-- ENDIF enabled -->
			</div>
		</div>
		<div class="panel panel-default">
			<div class="panel-heading">
				<h3 class="panel-title">
					Statistics
				</h3>
			</div>
			<div class="panel-body">
				<!-- IF stats -->
				<ul>
					<li>Total items indexed: {stats.total}</li>
					<li>Topics indexed: {stats.topics}</li>
				</ul>
				<!-- ELSE -->
				<p>
					There are no statistics to report.
				</p>
				<!-- ENDIF stats -->
			</div>
		</div>
		<div class="panel panel-warning">
			<div class="panel-heading">Advanced Options</div>
			<div class="panel-body">
				<button class="btn btn-block btn-default" data-action="dropCaches">Drop Search Cache</button>
				<p class="help-block">
					Searches made by forum users are saved for twenty minutes, in order to reduce strain on the
					search engine. Utilise this option if you wish to drop this cache so all new searches directly
					query Solr again.
				</p>
				<button class="btn btn-block btn-success" data-action="rebuild">Rebuild Search Index</button>
				<p class="help-block">
					This option reads every topic and post saved in the database and adds it to the search index.
					Any topics already indexed will have their contents replaced, so there is no need to flush
					the index prior to re-indexing.
				</p>
				<button class="btn btn-block btn-danger" data-action="flush">Flush Search Index</button>
				<p class="help-block">
					Flushing the search index will remove all references to searchable assets
					in the Solr backend, and your users will no longer be able to search for
					topics. New topics and posts made after a flush will still be indexed.
				</p>
			</div>
		</div>
	</div>
</div>

<script>
	$(document).ready(function() {
		'use strict';
		/* globals $, app, bootbox, config, ajaxify, require, socket */

		var	csrf = '{csrf}' || $('#csrf_token').val();

		// Flush event
		$('button[data-action="flush"]').on('click', function() {
			bootbox.confirm('Are you sure you wish to empty the Solr search index?', function(confirm) {
				if (confirm) {
					$.ajax({
						url: config.relative_path + '/admin/plugins/solr/flush',
						type: 'DELETE',
						data: {
							_csrf: csrf
						}
					}).success(function() {
						ajaxify.refresh();

						app.alert({
							type: 'success',
							alert_id: 'solr-flushed',
							title: 'Search index flushed',
							timeout: 2500
						});
					});
				}
			});
		});

		// Drop caches event
		$('button[data-action="dropCaches"]').on('click', function() {
			$.ajax({
				url: config.relative_path + '/admin/plugins/solr/cache',
				type: 'DELETE',
				data: {
					_csrf: csrf
				}
			}).success(function() {
				app.alert({
					type: 'success',
					alert_id: 'solr-flushed',
					title: 'Search cache dropped',
					timeout: 2500
				});
			});
		});

		// Toggle event
		$('button[data-action="toggle"]').on('click', function() {
			$.ajax({
				url: config.relative_path + '/admin/plugins/solr/toggle',
				type: 'POST',
				data: {
					_csrf: csrf,
					state: parseInt($('button[data-action="toggle"]').attr('data-enabled'), 10) ^ 1
				}
			}).success(ajaxify.refresh);
		});

		// Index All event
		$('button[data-action="rebuild"]').on('click', function() {
			bootbox.confirm('Rebuild search index?', function(confirm) {
				if (confirm) {
					bootbox.dialog({
						title: 'Rebuilding Solr Index...',
						message: '<div class="progress reindex"><div class="progress-bar progress-bar-striped active" role="progressbar" aria-valuenow="5" aria-valuemin="0" aria-valuemax="100" style="width: 5%"><span class="sr-only">5% Complete</span></div></div>'
					});

					$.ajax({
						url: config.relative_path + '/admin/plugins/solr/rebuild',
						type: 'POST',
						data: {
							_csrf: csrf
						}
					}).success(function() {
						checkIndexStatus(function() {
							ajaxify.refresh();

							app.alert({
								type: 'success',
								alert_id: 'solr-rebuilt',
								title: 'Search index rebuilt',
								timeout: 2500
							});
						});
					}).fail(function() {
						app.alertError('Solr encountered an error while indexing posts and topics');
					});
				}
			});
		});

		// Settings form event
		require(['settings'], function(Settings) {
			Settings.load('solr', $('.solr-settings'));

			$('#save').on('click', function() {
				Settings.save('solr', $('.solr-settings'), function() {
					app.alert({
						type: 'success',
						alert_id: 'solr-saved',
						title: 'Settings Saved',
						message: 'Click here to reload NodeBB',
						timeout: 2500,
						clickfn: function() {
							socket.emit('admin.reload');
						}
					});
				});
			});
		});

		var checkIndexStatus = function(callback) {
				var barEl = $('.progress.reindex .progress-bar'),
					spanEl = barEl.find('span'),
					modalEl = barEl.parents('.modal'),
					progress;

				$.get(config.relative_path + '/admin/plugins/solr/rebuildProgress').success(function(percentage) {
					progress = parseFloat(percentage);
					if (progress !== -1) {
						if (progress > 5) { updateBar(progress); }
						setTimeout(function() {
							checkIndexStatus(callback);
						}, 250);
					} else {
						modalEl.modal('hide');
						callback();
					}
				});
			},
			updateBar = function(percentage) {
				var barEl = $('.progress.reindex .progress-bar'),
					spanEl = barEl.find('span');

				barEl.css('width', percentage + '%');
				barEl.attr('aria-valuenow', percentage);
				spanEl.text(percentage + '% Complete');
			};
	});
</script>