//------------------------------------------------ globals ---------------------------------------------------//
var trainsToDisplay = 10;
var myStationShortCode = "";

var arrival = {};
var departure = {};

var stations = {};

var stationNames = [];
var commercialTrainTypes = [];
//------------------------------------------------ globals ---------------------------------------------------//
//------------------------------------------------ init ---------------------------------------------------//
$(function() {

	setStations();
	setCommercialTrainTypes();
	
	setInterval(isPageFocused,2000); //disconnects the websocket/mqtt connection when page is not focused so it doesn't sperg out in the background
	
	var prevFocus = document.hasFocus(); 
	function isPageFocused() {
		if (!document.hasFocus() && prevFocus) {
			client.disconnect();
		} else if (!prevFocus && document.hasFocus()){
			client.connect(options);
		}
		prevFocus = document.hasFocus();
	}
	
	$( "#tags" ).autocomplete({
		minLength: 2,
		autoFocus: true,
		source: stationNames,
		select: function( event , ui ) {
			resetMyStation(ui.item.label);
			$( "#tags").addClass("ui-result-valid")
		}
	});
});
//------------------------------------------------ init ---------------------------------------------------//
//------------------------------------------------ websocket/mqtt ---------------------------------------------------//
var client = new Messaging.Client("rata.digitraffic.fi", 443, "myclientid_" + parseInt(Math.random() * 10000, 10));

var options = {
	useSSL:true,
	timeout: 3,
	onSuccess: function() {
		if (myStationShortCode !== "") { //on reconnect/reopen when a search has been done already
			resetMyStation(myStationShortCode);
		}
	},
	onFailure: function(message) {
	}
};

client.connect(options);

client.onMessageArrived = function(message) {
	
	setSingleTrainToCollection(JSON.parse(message.payloadString));
	displayTrainCollection("arrival");
	displayTrainCollection("departure");
};

client.onConnectionLost = function(responseObject) {
}; 
//------------------------------------------------ websocket/mqtt ---------------------------------------------------//

function resetMyStation(station) {
	
	for (var k in stations) {
		if (stations[k].stationName === station) {
			myStationShortCode = stations[k].stationShortCode;
			break;
		}
	}
	
	setTrainCollections();
	client.subscribe('trains-by-station/' + myStationShortCode, {qos: 0});
}		

function setCommercialTrainTypes() {
	$.ajax({
		url: 'https://rata.digitraffic.fi/api/v1/metadata/train-types'
	})
	.done(function( data ) {
		data.forEach(function(trains) {
			if (trains.trainCategory.name === "Commuter" || trains.trainCategory.name === "Long-distance") {
				commercialTrainTypes.push(trains.name);
			}
		});
	});
}

function setStations() {
	$.ajax({
		url: 'https://rata.digitraffic.fi/api/v1/metadata/stations'
	})
	.done(function( data ) {
		data.forEach(function(stationInfo) {
			if (stationInfo.passengerTraffic === true) {
				stations[stationInfo.stationUICCode] = {
					"stationName": stationInfo.stationName.replace(" asema", "").replace("_", " "),
					"stationShortCode": stationInfo.stationShortCode,
					"type": stationInfo.type,
					"countryCode": stationInfo.countryCode
				};
				stationNames.push(stationInfo.stationName.replace(" asema", "").replace("_", " "));
			}
		});
	});
}

function setTrainCollections() {
	$.ajax({
		url: "https://rata.digitraffic.fi/api/v1/live-trains/station/" + myStationShortCode + "?arrived_trains=50&departed_trains=50&departing_trains=50&arriving_trains=50"
	})
	.done(function( data ) {
		for (var member in arrival) delete arrival[member];
		arrival = {};
		for (var member in departure) delete departure[member];
		departure = {};
		
		data.forEach(function(trainInfo) {
			setSingleTrainToCollection(trainInfo);
		});
		displayTrainCollection("arrival");
		displayTrainCollection("departure");
	});
}

function setSingleTrainToCollection(data) {

	if (!commercialTrainTypes.includes(data.trainType)) {
		return;
	}
	
	var timeTable = data.timeTableRows;
	
	var departureStation_start = timeTable.find(function(tRow){
		return tRow.commercialStop !== undefined && tRow.type === "DEPARTURE";
	}).stationUICCode;
	var arrivalStation_end = timeTable.reverse().find(function(tRow){
		return tRow.commercialStop !== undefined && tRow.type === "ARRIVAL";
	}).stationUICCode;
	
	data.timeTableRows.forEach(function(row) {
		
		if (row.stationShortCode !== myStationShortCode || row.commercialStop !== true || row.trainStopping === false) {
			return true;
		}
		
		var item = {
			"trainNumber": data.trainNumber,
			"trainType": data.trainType,
			"type": row.type,
			"commuterLineID": data.commuterLineID,
			"scheduledTime": new Date(row.scheduledTime),
			"estimatedTime": new Date(row.liveEstimateTime),
			"sortTime": new Date((typeof(row.liveEstimateTime) !== "undefined") ? row.liveEstimateTime : ((typeof(row.scheduledTime) !== "undefined") ? row.scheduledTime : "")),
			"startStation": departureStation_start,
			"endStation": arrivalStation_end,
			"cancelled": data.cancelled
		};
		
		
		if (row.type === "DEPARTURE") {
			if (typeof row.actualTime !== "string") {
				departure[data.trainNumber] = item;
			} else if (typeof departure[data.trainNumber] !== "undefined") {
				delete departure[data.trainNumber];
			}
		} 
		else if (row.type === "ARRIVAL") {
			if (typeof row.actualTime !== "string") {
				arrival[data.trainNumber] = item;
			} else if (typeof arrival[data.trainNumber] !== "undefined") {
				delete arrival[data.trainNumber];
			}
		}
	}); 
}

function displayTrainCollection(arr_name) {
	var tempArr = Object.keys(window[arr_name]).map(function(key) {
		return [Number(key),window[arr_name][key]];
	});
	tempArr.sort(function (a, b) {return b[1].sortTime - a[1].sortTime});
	tempArr = tempArr.reverse().slice(0,trainsToDisplay).reverse();
	
	var tag = "#outbound";
	if (arr_name == "arrival") {
		tag = "#inbound";
	}
	
	$(tag).empty();
	
	for (var i = 0, len = trainsToDisplay; i < len; i++) {
	
		if (typeof tempArr[i] === "undefined") {
			continue;
		}
		
		var trainInfo = tempArr[i][1];
		
		var trainNumber = (trainInfo.commuterLineID) ? 'Commuter Line ' + trainInfo.commuterLineID : trainInfo.trainType + " " + trainInfo.trainNumber;
		var scheduledTime = trainInfo.scheduledTime.toLocaleTimeString('fi-FI', {hour: '2-digit', minute:'2-digit', hour12: false});
		
		var estimatedTime = "";
		if (trainInfo.estimatedTime) {
			estimatedTime = trainInfo.estimatedTime.toLocaleTimeString('fi-FI', {hour: '2-digit', minute:'2-digit', hour12: false});
		}
		
		var cancelled = ''; 
		if (trainInfo.cancelled) {
			cancelled = 'cancelled';
		}
		
		var htmlFinalCol = '<td class="single-line"><p style="display:block;">' + scheduledTime + '</p></td>';
		if (trainInfo.cancelled) {
			htmlFinalCol = '<td class="double-line delayed"><div class="delayed-top">' + estimatedTime + '</div><div class="delayed-bottom">CANCELLED</div></td>';
		} else if (estimatedTime !== scheduledTime && estimatedTime !== "Invalid Date") {
			htmlFinalCol = '<td class="double-line delayed"><div class="delayed-top">' + estimatedTime + '</div><div class="delayed-bottom">(' + scheduledTime + ')</div></td>';
		}
		
		$(tag).prepend('<tr class="' + cancelled + '">');
		$(tag + ' > tr:first').prepend(
			'<td class="single-line">' + trainNumber + '</td>' +
			'<td class="single-line">' + stations[trainInfo.startStation].stationName + '</td>' +
			'<td class="single-line">' + stations[trainInfo.endStation].stationName + '</td>' +
			htmlFinalCol
		);
		
	}
}

/* ===============================================
* jquery-ui-autocomplete-with-clear-button.js v0.0.1
*
* Extends jQuery UI Autocomplete widget with a button that clears the value of the autocomplete input.
* The following options are available:
* - `clearButton` -  type: Boolean, default: true - adds a button that will clear the autocomplete input
* - `clearButtonHtml`- type: String, default: '&times;' - the content of the button
* - `clearButtonPosition` - type: Object|Boolean, default: {my: "right center", at: "right center"} - an object with the parameters needed to position the button using jQuery UI Position (http://api.jqueryui.com/position/). Set it to `false` if you want to position the button via CSS.
* ============================================ */
(function($) {

	$.widget( "ui.autocomplete", $.ui.autocomplete, {
		// extend default options
		options : {
			clearButton: true,
			clearButtonHtml: '&times;',
			clearButtonPosition: {
				my: "right center",
				at: "right center"
			}
		},

		_create: function() {

			var self = this;
			// Invoke the parent widget's method.
			self._super();

			if ( self.options.clearButton ) {
				self._createClearButton();
			}

		},

		_createClearButton: function() {

			var self = this;

			self.clearElement = $("<span>")
							.attr( "tabindex", "-1" )
							.addClass( "ui-autocomplete-clear" )
							.html( self.options.clearButtonHtml )
							.appendTo( self.element.parent() 
			);

			if ( self.options.clearButtonPosition !== false && typeof self.options.clearButtonPosition === 'object' ) {
				if ( typeof self.options.clearButtonPosition.of === 'undefined' ) {
					self.options.clearButtonPosition.of = self.element;
				}
				self.clearElement.position( self.options.clearButtonPosition);
			}

			self._on( self.clearElement, {
				click: function() {
					self.element.val('').focus();
					self._hideClearButton();
				
					$( "#tags").removeClass("ui-result-valid")
				}
			});

			self.element.addClass('ui-autocomplete-input-has-clear');

			self._on( self.element, {
				input: function() {
					if ( self.element.val()!=="" ) {
						self._showClearButton();
					} else {
						self._hideClearButton();
					}
				}
			});

			self._on( self.menu.element, {
				menuselect: function() {
					self._showClearButton();
				}
			});

			// show clearElement if input has some content on initialization
			if( self.element.val()!=="" ) {
				self._showClearButton();
			} else {
				self._hideClearButton();
			}

		},

		_showClearButton: function() {
			this.clearElement.css({'display': 'inline'});
		},
		
		_hideClearButton: function() {
			this.clearElement.css({'display': 'none'});
		}

	});

})(window.jQuery);
