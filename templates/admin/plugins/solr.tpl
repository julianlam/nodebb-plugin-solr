<h1><i class="fa fa-search"></i> Apache Solr</h1>

<div class="row">
	<div class="col-sm-8">
		<h2>Client Configuration</h2>
		<form role="form" class="solr-settings">
			<div class="form-group">
				<label for="host">Host</label>
				<input class="form-control" type="text" name="host" id="host" placeholder="127.0.0.1" />
			</div>
			<div class="form-group">
				<label for="port">Port</label>
				<input class="form-control" type="text" name="port" id="port" placeholder="8983" />
			</div>
			<button id="save" type="button" class="btn btn-primary btn-block">Save</button>
		</form>

		<h2>Advanced Options</h2>
		<button class="btn btn-success" data-action="rebuild">Rebuild Search Index</button>
		<p class="help-block">
			This option reads every topic and post saved in the database and adds it to the search index.
			Any topics already indexed will have their contents replaced, so there is no need to flush
			the index prior to re-indexing.
		</p>
		<button class="btn btn-danger" data-action="flush">Flush Search Index</button>
		<p class="help-block">
			Flushing the search index will remove all references to searchable assets
			in the Solr backend, and your users will no longer be able to search for
			topics. New topics and posts made after a flush will still be indexed.
		</p>
	</div>
	<div class="col-sm-4">
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
				<p>
					Total items indexed: {stats.total}
				</p>
				<!-- ELSE -->
				<p>
					There are no statistics to report.
				</p>
				<!-- ENDIF stats -->
			</div>
		</div>
	</div>
</div>
<script>
	$(document).ready(function() {
		var	csrf = '{csrf_token}' || $('#csrf_token').val();
		
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

		// Index All event
		$('button[data-action="rebuild"]').on('click', function() {
			bootbox.confirm('Rebuild search index?', function(confirm) {
				if (confirm) {
					app.alert({
						type: 'info',
						alert_id: 'solr-rebuilt',
						title: '<i class="fa fa-refresh fa-spin"></i> Rebuilding search index...',
						timeout: 2500
					});

					$.ajax({
						url: config.relative_path + '/admin/plugins/solr/rebuild',
						type: 'POST',
						data: {
							_csrf: csrf
						}
					}).success(function() {
						ajaxify.refresh();

						app.alert({
							type: 'success',
							alert_id: 'solr-rebuilt',
							title: 'Search index rebuilt',
							timeout: 2500
						});
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
						timeout: 2500
					});

					// Short delay to allow new Solr object to be created, server-side.
					setTimeout(function() {
						ajaxify.refresh();
					}, 250);
				});
			});
		});
	});
</script>