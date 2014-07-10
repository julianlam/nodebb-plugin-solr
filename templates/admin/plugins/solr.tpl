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
</script>