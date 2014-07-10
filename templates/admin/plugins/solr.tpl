<h1><i class="fa fa-search"></i> Apache Solr</h1>

<div class="row">
	<div class="col-sm-8">
		<h2>Client Configuration</h2>
		<form role="form">
			<div class="form-group">
				<label for="host">Host</label>
				<input class="form-control" type="text" name="host" id="host" placeholder="127.0.0.1" />
			</div>
			<div class="form-group">
				<label for="port">Port</label>
				<input class="form-control" type="text" name="port" id="port" placeholder="8983" />
			</div>
			<button type="button" class="btn btn-primary btn-block">Save</button>
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
	</div>