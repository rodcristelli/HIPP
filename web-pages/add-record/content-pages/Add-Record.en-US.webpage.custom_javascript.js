/* The CSV is deployed as a web file at the path below. Keep the source outside
	 the page copy so its row order remains the single source of truth. */
(function () {
	"use strict";
	function boot() {

	var definitionsUrl = "/hipp-field-definitions.json";
	var form = document.getElementById("hipp-application-form");
	var fieldsContainer = document.getElementById("hipp-form-fields");
	var status = document.getElementById("hipp-form-status");
	var submitButton = document.getElementById("hipp-submit");
	var submitHint = document.getElementById("hipp-submit-hint");
	var progressContainer = document.getElementById("hipp-form-progress");
	var progressBar = document.getElementById("hipp-form-progress-bar");
	var scanner = document.getElementById("hipp-pdf-scanner");
	var scanFileInput = document.getElementById("hipp-pdf-file");
	var scanButton = document.getElementById("hipp-pdf-scan");
	var scanStatus = document.getElementById("hipp-pdf-status");
	var scanSummary = document.getElementById("hipp-pdf-summary");
	var scanProgress = document.getElementById("hipp-pdf-progress");
	var scanProgressBar = document.getElementById("hipp-pdf-progress-bar");
	var definitions = [];
	var definitionsReady = false;
	var pendingScannedPdf = null;
	var scanBusy = false;
	var maxPdfBytes = 10 * 1024 * 1024;
	var refreshVisibility = function () {};

	if (!form || !fieldsContainer) {
		return;
	}
	submitButton.disabled = true;

	function csvRows(text) {
		var rows = [];
		var row = [];
		var value = "";
		var quoted = false;

		for (var index = 0; index < text.length; index += 1) {
			var character = text[index];
			var next = text[index + 1];
			if (character === '"' && quoted && next === '"') {
				value += '"';
				index += 1;
			} else if (character === '"') {
				quoted = !quoted;
			} else if (character === "," && !quoted) {
				row.push(value);
				value = "";
			} else if ((character === "\n" || character === "\r") && !quoted) {
				if (character === "\r" && next === "\n") {
					index += 1;
				}
				row.push(value);
				if (row.some(function (cell) { return cell.trim() !== ""; })) {
					rows.push(row);
				}
				row = [];
				value = "";
			} else {
				value += character;
			}
		}
		if (value !== "" || row.length) {
			row.push(value);
			rows.push(row);
		}
		return rows;
	}

	function parseCsv(text) {
		var rows = csvRows(text);
		var header = rows.shift().map(function (name) { return name.trim(); });
		var index = {};
		header.forEach(function (name, position) { index[name] = position; });
		return rows.map(function (row) {
			return {
				name: (row[index["Variable / Field Name"]] || "").trim(),
				section: (row[index["Section Header"]] || "").trim(),
				type: (row[index["Field Type"]] || "text").trim().toLowerCase(),
				label: (row[index["Field Label"]] || "").trim(),
				choices: (row[index["Choices, Calculations, OR Slider Labels"]] || "").trim(),
				note: (row[index["Field Note"]] || "").trim(),
				validation: (row[index["Text Validation Type OR Show Slider Number"]] || "").trim(),
				min: (row[index["Text Validation Min"]] || "").trim(),
				max: (row[index["Text Validation Max"]] || "").trim(),
				branching: (row[index["Branching Logic (Show field only if...)"]] || "").trim(),
				annotation: (row[index["Field Annotation"]] || "").trim(),
				required: (row[index["Required Field?"]] || "").trim().toLowerCase() === "y"
			};
		}).filter(function (field) { return field.name && field.label; });
	}

	function choices(value) {
		return value.split("|").map(function (choice) {
			var parts = choice.split(/,\s*/);
			return { value: (parts.shift() || "").trim(), label: parts.join(", ").trim() };
		}).filter(function (choice) { return choice.value && choice.label; });
	}

	function safeId(name) {
		return "hipp-" + name.replace(/[^a-zA-Z0-9_-]/g, "-");
	}

	function annotationDefault(field) {
		var match = (field.annotation || "").match(/@DEFAULT="([^"]*)"/);
		return match ? match[1] : null;
	}

	function validationMessage(field) {
		if (field.validation === "date_mdy") {
			return "Enter a valid date" + (field.min || field.max ? " within the allowed date range" : "") + ".";
		}
		if (field.validation === "integer") {
			return "Enter a whole number" + (field.min || field.max ? " within the allowed range" : "") + ".";
		}
		if (field.validation === "number") {
			return "Enter a number" + (field.min || field.max ? " within the allowed range" : "") + ".";
		}
		return "Enter a valid value.";
	}

	function addValidationAttributes(control, field) {
		if (field.validation === "number") {
			control.type = "number";
			control.step = "any";
		} else if (field.validation === "integer") {
			control.type = "number";
			control.step = "1";
		} else if (field.validation === "date_mdy") {
			control.type = "date";
		}
		if (field.min !== "") control.min = field.min;
		if (field.max !== "") control.max = field.max;
	}

	function setStatus(message, isError) {
		status.hidden = !message;
		status.textContent = message;
		status.className = "hipp-form-status" + (isError ? " is-error" : " is-success");
	}

	function setProgress(percent) {
		if (!progressContainer || !progressBar) return;
		progressContainer.hidden = percent === null;
		progressBar.style.width = (percent === null ? 0 : percent) + "%";
	}

	function setScanStatus(message, isError) {
		if (!scanStatus) return;
		scanStatus.hidden = !message;
		scanStatus.textContent = message;
		scanStatus.className = "hipp-form-status" + (isError ? " is-error" : " is-success");
	}

	function setScanBusy(isBusy) {
		scanBusy = isBusy;
		if (scanner) scanner.setAttribute("aria-busy", isBusy ? "true" : "false");
		if (scanFileInput) scanFileInput.disabled = isBusy;
		if (scanProgress && scanProgressBar) {
			scanProgress.hidden = !isBusy;
			scanProgress.classList.toggle("is-busy", isBusy);
			scanProgressBar.style.width = isBusy ? "45%" : "0%";
		}
		updateScanButtonState();
		updateSubmitState();
	}

	function createControl(field) {
		var id = safeId(field.name);
		var wrapper = document.createElement("div");
		wrapper.className = "hipp-field";
		wrapper.dataset.fieldName = field.name;
		wrapper.dataset.branching = field.branching;
		wrapper.dataset.annotationHidden = (field.annotation || "").indexOf("@HIDDEN") !== -1 ? "true" : "false";
		var label = document.createElement("label");
		label.htmlFor = id;
		label.textContent = field.label + (field.required ? " *" : "");
		wrapper.appendChild(label);

		if (field.type === "descriptive") {
			wrapper.className = "hipp-field hipp-description";
			wrapper.textContent = field.label;
			if (field.note) {
				var descriptiveNote = document.createElement("small");
				descriptiveNote.className = "hipp-field-note";
				descriptiveNote.textContent = field.note;
				wrapper.appendChild(descriptiveNote);
			}
			return wrapper;
		}

		var control;
		if (field.type === "radio" || field.type === "checkbox") {
			control = document.createElement("div");
			control.className = "hipp-options";
			choices(field.choices).forEach(function (choice, choiceIndex) {
				var optionId = id + "-" + choiceIndex;
				var optionLabel = document.createElement("label");
				optionLabel.htmlFor = optionId;
				var input = document.createElement("input");
				input.id = optionId;
				input.name = field.name + (field.type === "checkbox" ? "[]" : "");
				input.type = field.type;
				input.value = choice.value;
				input.dataset.fieldName = field.name;
				optionLabel.appendChild(input);
				optionLabel.appendChild(document.createTextNode(" " + choice.label));
				control.appendChild(optionLabel);
			});
		} else if (field.type === "file") {
			control = document.createElement("input");
			control.type = "file";
			control.id = id;
			control.name = field.name;
			control.dataset.fieldName = field.name;
		} else {
			control = document.createElement("input");
			control.id = id;
			control.name = field.name;
			control.type = field.type === "date_mdy" ? "date" : (field.type === "integer" ? "number" : field.type);
			control.dataset.fieldName = field.name;
			addValidationAttributes(control, field);
		}
		if (field.note) {
			var note = document.createElement("small");
			note.className = "hipp-field-note";
			note.id = id + "-note";
			note.textContent = field.note;
			label.setAttribute("aria-describedby", note.id);
			wrapper.appendChild(note);
		}
		var defaultValue = annotationDefault(field);
		if (defaultValue !== null && field.type !== "radio" && field.type !== "checkbox" && field.type !== "file") {
			control.value = defaultValue;
		}
		if ((field.annotation || "").indexOf("@USERNAME") !== -1) {
			control.value = form.dataset.currentUserEmail || "";
		}
		if (wrapper.dataset.annotationHidden === "true") wrapper.hidden = true;
		if (field.validation && field.validation !== "date_mdy" && field.validation !== "number" && field.validation !== "integer") {
			control.pattern = field.validation;
		}
		var validationError = document.createElement("small");
		validationError.className = "hipp-validation-error";
		validationError.hidden = true;
		validationError.textContent = validationMessage(field);
		wrapper.appendChild(validationError);
		var inputs = field.type === "radio" || field.type === "checkbox"
			? Array.from(control.querySelectorAll("input"))
			: [control];
		inputs.forEach(function (input) {
			input.addEventListener("input", function () {
				if (field.type === "radio" || field.type === "checkbox") {
					validationError.hidden = inputs.some(function (option) { return option.checked; });
				} else {
					validationError.hidden = input.validity.valid || !input.value;
				}
			});
		});
		if (field.required && field.type !== "descriptive") {
			if (field.type === "radio") {
				inputs[0].required = true;
			} else if (field.type === "checkbox") {
				wrapper.dataset.groupRequired = "true";
			} else {
				control.required = true;
			}
		}
		wrapper.appendChild(control);
		return wrapper;
	}

	function compare(left, operator, right) {
		if (operator === "=") return String(left) === right.replace(/^['"]|['"]$/g, "");
		if (operator === ">") return Number(left) > Number(right);
		if (operator === "<") return Number(left) < Number(right);
		return false;
	}

	function getFieldControls(name) {
		return getAllFieldControls(name)
			.filter(function (input) { return !input.disabled; });
	}

	function getAllFieldControls(name) {
		return Array.from(form.querySelectorAll('input[data-field-name="' + name + '"], select[data-field-name="' + name + '"], textarea[data-field-name="' + name + '"]'));
	}

	function getValue(name) {
		var controls = getFieldControls(name);
		if (!controls.length) return "";
		if (controls[0].type === "checkbox") return controls.filter(function (input) { return input.checked; }).map(function (input) { return input.value; });
		if (controls[0].type === "radio") {
			var selected = controls.find(function (input) { return input.checked; });
			return selected ? selected.value : "";
		}
		return controls[0].value;
	}

	function stripOuterParentheses(expression) {
		var value = expression.trim();
		while (value[0] === "(" && value[value.length - 1] === ")") {
			var depth = 0;
			var wrapsWholeExpression = true;
			for (var index = 0; index < value.length; index += 1) {
				if (value[index] === "(") depth += 1;
				if (value[index] === ")") depth -= 1;
				if (depth === 0 && index < value.length - 1) {
					wrapsWholeExpression = false;
					break;
				}
			}
			if (!wrapsWholeExpression) break;
			value = value.slice(1, -1).trim();
		}
		return value;
	}

	function splitTopLevel(expression, operator) {
		var parts = [];
		var start = 0;
		var depth = 0;
		var token = " " + operator + " ";
		for (var index = 0; index < expression.length; index += 1) {
			if (expression[index] === "(") depth += 1;
			if (expression[index] === ")") depth -= 1;
			if (depth === 0 && expression.slice(index, index + token.length).toLowerCase() === token) {
				parts.push(expression.slice(start, index));
				start = index + token.length;
				index += token.length - 1;
			}
		}
		parts.push(expression.slice(start));
		return parts;
	}

	function evaluateCondition(condition) {
		var match = condition.trim().match(/^\[([^\]]+)\]\s*(=|>|<)\s*(['"]?)(.*?)\3$/);
		if (!match) return false;
		var reference = match[1];
		var optionMatch = reference.match(/^(.+)\((\d+)\)$/);
		var fieldName = optionMatch ? optionMatch[1] : reference;
		var value = getValue(fieldName);
		if (optionMatch) {
			value = Array.isArray(value) && value.indexOf(optionMatch[2]) !== -1 ? optionMatch[2] : "";
		}
		return compare(Array.isArray(value) ? value.join(",") : value, match[2], match[4]);
	}

	function evaluateBranching(expression) {
		var value = stripOuterParentheses(expression);
		var orParts = splitTopLevel(value, "or");
		if (orParts.length > 1) return orParts.some(evaluateBranching);
		var andParts = splitTopLevel(value, "and");
		if (andParts.length > 1) return andParts.every(evaluateBranching);
		return evaluateCondition(value);
	}

	function visible(field) {
		return !field.branching || evaluateBranching(field.branching);
	}

	function render() {
		fieldsContainer.replaceChildren();
		var currentSection = null;
		definitions.forEach(function (field) {
			if (field.section && (!currentSection || currentSection.dataset.section !== field.section)) {
				currentSection = document.createElement("fieldset");
				currentSection.dataset.section = field.section;
				var legend = document.createElement("legend");
				if (field.section.length > 100 || /^Note:/i.test(field.section)) {
					legend.className = "hipp-section-note";
				}
				legend.textContent = field.section;
				currentSection.appendChild(legend);
				fieldsContainer.appendChild(currentSection);
			}
			(currentSection || fieldsContainer).appendChild(createControl(field));
		});
		refreshVisibility = function () {
			definitions.forEach(function (field) {
				var node = form.querySelector('[data-field-name="' + field.name + '"]');
				if (node) {
					var fieldElement = node.closest(".hipp-field");
					if (!fieldElement) return;
					var isVisible = visible(field);
					var annotationHidden = fieldElement.dataset.annotationHidden === "true";
					fieldElement.hidden = annotationHidden || !isVisible;
					var fieldInputs = fieldElement.querySelectorAll("input, select, textarea");
					fieldInputs.forEach(function (input) {
						input.disabled = !isVisible && !annotationHidden;
						if (field.type === "radio") {
							input.required = isVisible && field.required && input === fieldInputs[0];
						} else if (field.type !== "checkbox") {
							input.required = isVisible && field.required;
						}
					});
				}
			});
			updateSubmitState();
		};
		form.addEventListener("change", refreshVisibility);
		form.addEventListener("input", refreshVisibility);
		refreshVisibility();
	}

	function requestToken() {
		if (window.shell && typeof window.shell.getTokenDeferred === "function") {
			return new Promise(function (resolve, reject) { window.shell.getTokenDeferred().done(resolve).fail(reject); });
		}
		var token = document.querySelector('input[name="__RequestVerificationToken"]');
		return Promise.resolve(token ? token.value : "");
	}

	function recordName() {
		var person = [getValue("p_first_name"), getValue("p_last_name")].filter(Boolean).join(" ").trim();
		return (person || "HIPP Request") + " - " + new Date().toISOString();
	}

	function collectFileUploads() {
		var uploads = [];
		definitions.forEach(function (field) {
			if (field.type !== "file") return;
			var fieldElement = form.querySelector('[data-field-name="' + field.name + '"]');
			if (!fieldElement || (fieldElement.hidden && fieldElement.dataset.annotationHidden !== "true")) return;
			var node = getFieldControls(field.name)[0];
			Array.from((node && node.files) || []).forEach(function (file) { uploads.push({ field: field, file: file }); });
		});
		if (pendingScannedPdf) uploads.push({ field: { label: "Source HIPP PDF" }, file: pendingScannedPdf });
		return uploads;
	}

	function fileToBase64(file) {
		return new Promise(function (resolve, reject) {
			var reader = new FileReader();
			reader.onload = function () { resolve(String(reader.result).split(",").pop()); };
			reader.onerror = function () { reject(reader.error); };
			reader.readAsDataURL(file);
		});
	}

	function cloudFlowUrl() {
		var flowId = scanner ? (scanner.dataset.cloudFlowId || "").trim() : "";
		if (!flowId) return "";
		if (flowId.indexOf("/_api/cloudflow/") === 0) return flowId;
		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(flowId)) return "";
		return "/_api/cloudflow/v1.0/trigger/" + flowId;
	}

	function parseJsonValue(value) {
		var parsed = value;
		for (var count = 0; count < 3 && typeof parsed === "string"; count += 1) parsed = JSON.parse(parsed);
		return parsed;
	}

	function contentUnderstandingValue(field) {
		if (!field || typeof field !== "object") return field;
		if (Object.prototype.hasOwnProperty.call(field, "value")) return field.value;
		if (field.type === "object") {
			var objectValue = {};
			Object.keys(field.valueObject || {}).forEach(function (name) {
				objectValue[name] = contentUnderstandingValue(field.valueObject[name]);
			});
			return objectValue;
		}
		if (field.type === "array") return (field.valueArray || []).map(contentUnderstandingValue);
		var valueKeys = ["valueString", "valueDate", "valueTime", "valuePhoneNumber", "valueCountryRegion", "valueInteger", "valueNumber", "valueBoolean"];
		for (var index = 0; index < valueKeys.length; index += 1) {
			if (Object.prototype.hasOwnProperty.call(field, valueKeys[index])) return field[valueKeys[index]];
		}
		return null;
	}

	function flattenContentFields(fields, prefix, entries) {
		Object.keys(fields || {}).forEach(function (name) {
			var field = fields[name] || {};
			var path = prefix ? prefix + "." + name : name;
			if (field.type === "object") {
				flattenContentFields(field.valueObject || {}, path, entries);
				return;
			}
			entries.push({
				logicalName: path,
				displayName: field.displayName || field.label || name,
				value: contentUnderstandingValue(field),
				confidence: field.confidence
			});
		});
	}

	function layoutGeometry(source) {
		var match = String(source || "").match(/^D\((\d+),([^)]*)\)/);
		if (!match) return null;
		var values = match[2].split(",").map(Number);
		if (values.length < 8 || values.slice(0, 8).some(function (value) { return !Number.isFinite(value); })) return null;
		var xValues = [values[0], values[2], values[4], values[6]];
		var yValues = [values[1], values[3], values[5], values[7]];
		return {
			page: Number(match[1]),
			x: (Math.min.apply(Math, xValues) + Math.max.apply(Math, xValues)) / 2,
			xMin: Math.min.apply(Math, xValues),
			xMax: Math.max.apply(Math, xValues),
			y: (Math.min.apply(Math, yValues) + Math.max.apply(Math, yValues)) / 2
		};
	}

	function layoutRecords(items, fallbackPage) {
		return (items || []).filter(function (item) { return item && item.content; }).map(function (item) {
			var geometry = layoutGeometry(item.source);
			return {
				text: String(item.content).replace(/\s+/g, " ").trim(),
				page: geometry ? geometry.page : fallbackPage,
				geometry: geometry,
				span: item.span || null
			};
		});
	}

	function householdNumberAt(offset, records) {
		var householdNumber = null;
		(records || []).forEach(function (record) {
			if (!record.span || record.span.offset > offset) return;
			var match = normalizedDisplayName(record.text).match(/\b(\d{1,2})(?:st|nd|rd|th)\s+(?:twelfth\s+)?person in household\b/);
			if (match) householdNumber = Number(match[1]);
		});
		return householdNumber;
	}

	function layoutFieldMatches(label, householdNumber) {
		var normalizedLabel = normalizedDisplayName(label);
		var matches = definitions.filter(function (field) {
			return field.label && normalizedDisplayName(field.label) === normalizedLabel && field.type !== "descriptive" && field.type !== "file";
		});
		var householdMatches = matches.filter(function (field) { return /^h\d+_/.test(field.name); });
		if (householdMatches.length) {
			return householdNumber ? householdMatches.filter(function (field) {
				return new RegExp("^h" + householdNumber + "_").test(field.name);
			}) : matches.filter(function (field) { return !/^h\d+_/.test(field.name); });
		}
		return matches;
	}

	function layoutLabelTail(text, label) {
		var normalizedText = normalizedDisplayName(text);
		var normalizedLabel = normalizedDisplayName(label);
		if (!normalizedLabel || (normalizedText !== normalizedLabel && normalizedText.indexOf(normalizedLabel + " ") !== 0)) return null;
		var escapedLabel = label.trim().split(/\s+/).map(function (part) {
			return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}).join("[\\s\\W_]+");
		var match = String(text).match(new RegExp("^\\s*" + escapedLabel + "(?:\\s*[:\\-]?\\s*|$)", "i"));
		return match ? String(text).slice(match[0].length).trim() : null;
	}

	function layoutValueText(value) {
		return String(value || "").replace(/[◉🔘☒☐]/g, " ").replace(/\([^)]*\)/g, " ").replace(/[|;]/g, " ").replace(/\s+/g, " ").trim();
	}

	function layoutScalarValue(field, value) {
		var text = layoutValueText(value);
		if (!text) return null;
		if (field.validation === "date_mdy" || field.type === "date_mdy") {
			var date = text.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/);
			return date ? date[0] : null;
		}
		if (field.validation === "number" || field.validation === "integer" || field.type === "number" || field.type === "integer") {
			var numericValue = text.replace(/,/g, "");
			return /^[-+]?\d+(?:\.\d+)?$/.test(numericValue) ? numericValue : null;
		}
		return text;
	}

	function isTableChoiceField(field) {
		return /^h\d+_relationship$/.test(field.name) ||
			["medical coverage", "pharmaceutical coverage", "dental coverage"].indexOf(normalizedDisplayName(field.label)) !== -1;
	}

	function nearbyLayoutValue(labelRecord, records) {
		if (!labelRecord.geometry) return null;
		var candidates = records.filter(function (record) {
			return record.geometry && record.page === labelRecord.page && record.geometry.xMin >= 3.35 &&
				Math.abs(record.geometry.y - labelRecord.geometry.y) <= 0.42 &&
				!/[◉🔘☒☐]/.test(record.text) && !/^\(?\s*(please|this information|the information)\b/i.test(record.text);
		}).sort(function (left, right) {
			return Math.abs(left.geometry.y - labelRecord.geometry.y) - Math.abs(right.geometry.y - labelRecord.geometry.y);
		});
		return candidates.length ? candidates[0] : null;
	}

	function selectedMarkNear(optionRecord, pageLines) {
		if (/[◉☒]/.test(optionRecord.text)) return true;
		if (!optionRecord.geometry) return false;
		return pageLines.some(function (line) {
			return line.geometry && line.page === optionRecord.page && /[◉☒]/.test(line.text) &&
				Math.abs(line.geometry.x - optionRecord.geometry.x) <= 0.35 &&
				Math.abs(line.geometry.y - optionRecord.geometry.y) <= 0.34;
		});
	}

	function layoutChoiceValue(field, labelRecord, pageLines) {
		if (!labelRecord.geometry) return null;
		var options = choices(field.choices);
		var selected = [];
		options.forEach(function (option) {
			var label = normalizedDisplayName(option.label);
			var matchingLines = pageLines.filter(function (line) {
				var text = normalizedDisplayName(line.text.replace(/[◉🔘☒☐]/g, " "));
				return line.geometry && line.page === labelRecord.page && text === label &&
					Math.abs(line.geometry.y - labelRecord.geometry.y) <= 0.72;
			}).sort(function (left, right) {
				return Math.abs(left.geometry.y - labelRecord.geometry.y) - Math.abs(right.geometry.y - labelRecord.geometry.y);
			});
			if (matchingLines.length && selectedMarkNear(matchingLines[0], pageLines)) selected.push(option.value);
		});
		return selected;
	}

	function layoutTableEntries(contents, contextRecords) {
		var entries = [];
		(contents || []).forEach(function (content) {
			(content.tables || []).forEach(function (table) {
				var cells = table.cells || [];
				var cell = function (row, column) {
					return cells.find(function (item) { return item.rowIndex === row && item.columnIndex === column; });
				};
				var labelCell = cell(1, 0);
				if (!labelCell) return;
				var label = String(labelCell.content || "").trim();
				var householdNumber = householdNumberAt(table.span ? table.span.offset : 0, contextRecords);
				var isRelationship = normalizedDisplayName(label) === "relationship to";
				var fields = isRelationship
					? definitions.filter(function (field) { return householdNumber && field.name === "h" + householdNumber + "_relationship"; })
					: layoutFieldMatches(label, householdNumber).filter(function (field) { return field.type === "radio"; });
				if (fields.length !== 1) return;
				var field = fields[0];
				var selected = [];
				for (var column = 1; column < table.columnCount; column += 1) {
					var marker = cell(1, column);
					var header = cell(0, column);
					if (!marker || !header || !/[◉☒]/.test(marker.content || "")) continue;
					var value = isRelationship
						? (choices(field.choices)[column - 1] || {}).value
						: choiceValue(field, header.content);
					if (typeof value !== "undefined" && value !== null) selected.push(value);
				}
				if (selected.length === 1) {
					entries.push({ logicalName: field.name, displayName: label, value: selected[0] });
				} else if (selected.length > 1) {
					entries.push({ logicalName: field.name, displayName: label, skipReason: "Multiple selections in the document table." });
				}
			});
		});
		return entries;
	}

	function layoutEntries(contents) {
		var entries = [];
		var contextRecords = [];
		var pageLines = {};
		(contents || []).forEach(function (content) {
			var paragraphs = layoutRecords(content.paragraphs);
			contextRecords = contextRecords.concat(paragraphs);
			(content.pages || []).forEach(function (page) {
				pageLines[page.pageNumber] = layoutRecords(page.lines, page.pageNumber);
			});
			if (!paragraphs.length) {
				(content.pages || []).forEach(function (page) {
					contextRecords = contextRecords.concat(pageLines[page.pageNumber] || []);
				});
			}
		});
		contextRecords.sort(function (left, right) {
			return (left.span ? left.span.offset : 0) - (right.span ? right.span.offset : 0);
		});

		contextRecords.forEach(function (record) {
			var householdNumber = householdNumberAt(record.span ? record.span.offset : 0, contextRecords);
			definitions.forEach(function (field) {
				if (field.type === "radio" || field.type === "checkbox" || field.type === "descriptive" || field.type === "file") return;
				var tail = layoutLabelTail(record.text, field.label || "");
				if (tail === null) return;
				var rawValue = tail || "";
				if (!layoutValueText(rawValue)) {
					var nearby = nearbyLayoutValue(record, contextRecords);
					if (nearby) rawValue = nearby.text;
				}
				var value = layoutScalarValue(field, rawValue);
				if (value === null || value === "") return;
				var matches = layoutFieldMatches(field.label, householdNumber);
				if (matches.length !== 1 || matches[0].name !== field.name) return;
				entries.push({ logicalName: field.name, displayName: field.label, value: value });
			});

			var currentHousehold = householdNumber;
			definitions.forEach(function (field) {
				if (field.type !== "radio" && field.type !== "checkbox") return;
				if (isTableChoiceField(field)) return;
				if (layoutLabelTail(record.text, field.label || "") !== "") return;
				var matches = layoutFieldMatches(field.label, currentHousehold);
				if (matches.length !== 1 || matches[0].name !== field.name || !record.geometry) return;
				var options = layoutChoiceValue(field, record, pageLines[record.page] || []);
				if (field.type === "radio") {
					if (options.length === 1) entries.push({ logicalName: field.name, displayName: field.label, value: options[0] });
					else if (options.length > 1) entries.push({ logicalName: field.name, displayName: field.label, skipReason: "Multiple selections detected." });
				} else if (options.length) {
					entries.push({ logicalName: field.name, displayName: field.label, value: options });
				}
			});
		});
		entries = entries.concat(layoutTableEntries(contents, contextRecords));
		var membersWithIdentity = {};
		entries.forEach(function (entry) {
			var identity = String(entry.logicalName || "").match(/^h(\d+)_(?:first_name|last_name|dob)$/);
			if (identity && entry.value) membersWithIdentity[identity[1]] = true;
		});
		return entries.map(function (entry) {
			var householdField = String(entry.logicalName || "").match(/^h(\d+)_/);
			if (!householdField || membersWithIdentity[householdField[1]] || !entry.value || entry.skipReason) return entry;
			entry.skipReason = "Household member identity was not found; selection was ignored.";
			return entry;
		});
	}

	function extractedEntries(response) {
		var payload = parseJsonValue(response);
		if (payload && Object.prototype.hasOwnProperty.call(payload, "ExtractionResult")) payload = parseJsonValue(payload.ExtractionResult);
		if (payload && Object.prototype.hasOwnProperty.call(payload, "returnjson")) payload = parseJsonValue(payload.returnjson);
		if (!payload || typeof payload !== "object") throw new Error("The scan returned an invalid response.");
		if (payload.status && ["succeeded", "success", "completed"].indexOf(String(payload.status).toLowerCase()) === -1) {
			throw new Error((payload.errors && payload.errors.join ? payload.errors.join("; ") : payload.error) || "The document scan did not complete.");
		}
		if (Array.isArray(payload.fields)) {
			return payload.fields.map(function (field) {
				return {
					logicalName: field.logicalName || field.name || "",
					displayName: field.displayName || field.label || "",
					value: contentUnderstandingValue(field),
					confidence: field.confidence
				};
			});
		}
		var contents = payload.result && payload.result.contents;
		if (Array.isArray(contents) && contents.some(function (content) {
			return content && (content.analyzerId === "prebuilt-layout" || content.markdown || content.pages || content.paragraphs);
		})) return layoutEntries(contents);
		var fields = payload.fields;
		if (!fields && contents && contents[0]) fields = contents[0].fields;
		if (!fields || typeof fields !== "object") throw new Error("The scan response did not contain extracted fields or supported layout data.");
		var entries = [];
		flattenContentFields(fields, "", entries);
		return entries;
	}

	function normalizedLogicalName(value) {
		return String(value || "").trim().toLowerCase();
	}

	function normalizedDisplayName(value) {
		return String(value || "").trim().toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
	}

	function fieldIndexes() {
		var logical = {};
		var display = {};
		definitions.forEach(function (field, index) {
			field.definitionIndex = index;
			logical[normalizedLogicalName(field.name)] = field;
			var label = normalizedDisplayName(field.label);
			if (!label) return;
			if (!display[label]) display[label] = [];
			display[label].push(field);
		});
		return { logical: logical, display: display };
	}

	function resolveExtractedField(entry, indexes) {
		var logical = normalizedLogicalName(entry.logicalName);
		if (logical && indexes.logical[logical]) return { field: indexes.logical[logical] };
		var display = normalizedDisplayName(entry.displayName || entry.logicalName);
		var matches = display ? indexes.display[display] || [] : [];
		if (matches.length === 1) return { field: matches[0] };
		return { ambiguous: matches.length > 1 };
	}

	function choiceValue(field, value) {
		var options = choices(field.choices);
		var text = String(value === true ? "Yes" : value === false ? "No" : value).trim();
		var exact = options.find(function (option) { return option.value === text; });
		if (exact) return exact.value;
		var label = normalizedDisplayName(text);
		var byLabel = options.filter(function (option) { return normalizedDisplayName(option.label) === label; });
		return byLabel.length === 1 ? byLabel[0].value : null;
	}

	function dateValue(value) {
		var text = String(value || "").trim();
		var iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (iso) return iso[1] + "-" + iso[2] + "-" + iso[3];
		var mdy = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
		if (!mdy) return null;
		return mdy[3] + "-" + ("0" + mdy[1]).slice(-2) + "-" + ("0" + mdy[2]).slice(-2);
	}

	function convertedValue(field, value) {
		if (value === null || typeof value === "undefined" || value === "") return null;
		if (field.type === "radio") return choiceValue(field, Array.isArray(value) ? value[0] : value);
		if (field.type === "checkbox") {
			var values = Array.isArray(value) ? value : [value];
			var converted = values.map(function (item) { return choiceValue(field, item); }).filter(function (item) { return item !== null; });
			return converted.length === values.length ? converted : null;
		}
		if (field.validation === "date_mdy" || field.type === "date_mdy") return dateValue(value);
		if (field.validation === "number" || field.validation === "integer" || field.type === "number" || field.type === "integer") {
			var numberText = String(value).trim();
			if (!Number.isFinite(Number(numberText)) && /^[\d\s,().+-]+$/.test(numberText)) numberText = numberText.replace(/[\s,()-]/g, "");
			if (!Number.isFinite(Number(numberText))) return null;
			if ((field.validation === "integer" || field.type === "integer") && !/^[-+]?\d+$/.test(numberText)) return null;
			return numberText;
		}
		if (typeof value === "object") return null;
		return String(value);
	}

	function controlsAreEmpty(controls) {
		if (!controls.length) return true;
		if (controls[0].type === "radio" || controls[0].type === "checkbox") return !controls.some(function (control) { return control.checked; });
		return !controls[0].value.trim();
	}

	function setFieldValue(field, value) {
		var controls = getAllFieldControls(field.name);
		if (!controls.length || !controlsAreEmpty(controls)) return false;
		if (field.type === "radio") {
			controls.forEach(function (control) { control.checked = control.value === value; });
		} else if (field.type === "checkbox") {
			controls.forEach(function (control) { control.checked = value.indexOf(control.value) !== -1; });
		} else {
			controls[0].value = value;
			if (!controls[0].checkValidity()) {
				controls[0].value = "";
				return false;
			}
		}
		controls[0].dispatchEvent(new Event("input", { bubbles: true }));
		controls[0].dispatchEvent(new Event("change", { bubbles: true }));
		return true;
	}

	function populateExtractedFields(entries) {
		var indexes = fieldIndexes();
		var results = { populated: [], existing: [], unmapped: [], ambiguous: [], invalid: [], unsupported: [] };
		var resolved = entries.map(function (entry) {
			return { entry: entry, resolution: resolveExtractedField(entry, indexes) };
		}).sort(function (left, right) {
			var leftIndex = left.resolution.field ? left.resolution.field.definitionIndex : definitions.length;
			var rightIndex = right.resolution.field ? right.resolution.field.definitionIndex : definitions.length;
			return leftIndex - rightIndex;
		});
		resolved.forEach(function (item) {
			var entry = item.entry;
			var resolution = item.resolution;
			var sourceName = entry.displayName || entry.logicalName || "Unnamed field";
			if (entry.skipReason) {
				results.ambiguous.push(sourceName + " (" + entry.skipReason + ")");
				return;
			}
			if (!resolution.field) {
				results[resolution.ambiguous ? "ambiguous" : "unmapped"].push(sourceName);
				return;
			}
			var field = resolution.field;
			if (field.type === "descriptive" || field.type === "file" || (field.annotation || "").indexOf("@HIDDEN") !== -1) {
				results.unsupported.push(field.label || field.name);
				return;
			}
			var controls = getAllFieldControls(field.name);
			if (!controlsAreEmpty(controls)) {
				results.existing.push(field.label || field.name);
				return;
			}
			var value = convertedValue(field, entry.value);
			if (value === null || !setFieldValue(field, value)) {
				results.invalid.push(field.label || field.name);
				return;
			}
			results.populated.push(field.label || field.name);
		});
		refreshVisibility();
		return results;
	}

	function showScanSummary(results) {
		if (!scanSummary) return;
		var sections = [
			["Populated", results.populated],
			["Kept existing values", results.existing],
			["Unmapped", results.unmapped],
			["Ambiguous", results.ambiguous],
			["Invalid", results.invalid],
			["Unsupported", results.unsupported]
		];
		scanSummary.replaceChildren();
		sections.forEach(function (section) {
			if (!section[1].length) return;
			var paragraph = document.createElement("p");
			var heading = document.createElement("strong");
			heading.textContent = section[0] + " (" + section[1].length + "): ";
			paragraph.appendChild(heading);
			paragraph.appendChild(document.createTextNode(section[1].join(", ")));
			scanSummary.appendChild(paragraph);
		});
		scanSummary.hidden = false;
	}

	function scanError(xhr) {
		if (xhr && (xhr.status === 401 || xhr.status === 403)) return new Error("Your session is not authorized to scan PDFs. Sign in again and retry.");
		var message = xhr && xhr.responseJSON && (xhr.responseJSON.error || xhr.responseJSON.message);
		return new Error(message || "The PDF could not be scanned.");
	}

	function invokeScanFlow(file) {
		var url = cloudFlowUrl();
		if (!url) return Promise.reject(new Error("PDF scanning is not configured for this environment."));
		if (!window.shell || typeof window.shell.ajaxSafePost !== "function") return Promise.reject(new Error("An authenticated portal session is required to scan PDFs."));
		return fileToBase64(file).then(function (base64) {
			return new Promise(function (resolve, reject) {
				window.shell.ajaxSafePost({
					type: "POST",
					url: url,
					data: { eventData: JSON.stringify({ text: file.name, text_1: base64 }) }
				}).done(resolve).fail(function (xhr) { reject(scanError(xhr)); });
			});
		});
	}

	function buildAnnotations(uploads) {
		// deep-insert via the relationship's navigation property; a standalone POST to /_api/annotations
		// referencing the parent with @odata.bind is rejected by the portal (associate not permitted that way)
		return Promise.all(uploads.map(function (upload) {
			return fileToBase64(upload.file).then(function (base64) {
				return {
					subject: upload.field.label,
					filename: upload.file.name,
					mimetype: upload.file.type || "application/octet-stream",
					documentbody: base64
				};
			});
		}));
	}

	function formData() {
		var data = {};
		definitions.forEach(function (field) {
			if (field.type === "descriptive") return;
			var fieldElement = form.querySelector('[data-field-name="' + field.name + '"]');
			var node = getFieldControls(field.name)[0];
			var isHidden = !fieldElement || (fieldElement.hidden && fieldElement.dataset.annotationHidden !== "true");
			if (isHidden) {
				// hidden fields keep their key so every record shares the same JSON shape
				data[field.name] = null;
				return;
			}
			var value = getValue(field.name);
			if (field.type === "file") {
				value = Array.from(node.files || []).map(function (file) { return { name: file.name, type: file.type, size: file.size, lastModified: file.lastModified }; });
			} else if ((field.type === "number" || field.type === "integer") && value !== "") {
				value = Number(value);
			}
			data[field.name] = value;
		});
		return data;
	}

	function validateDictionaryFields() {
		var valid = true;
		definitions.forEach(function (field) {
			if (field.type === "descriptive") return;
			var fieldElement = form.querySelector('[data-field-name="' + field.name + '"]');
			var node = getFieldControls(field.name)[0];
			if (!node || !fieldElement || (fieldElement.hidden && fieldElement.dataset.annotationHidden !== "true")) return;
			var error = fieldElement.querySelector(".hipp-validation-error");
			var inputs = field.type === "radio" || field.type === "checkbox"
				? Array.from(fieldElement.querySelectorAll('input[data-field-name="' + field.name + '"]')).filter(function (input) { return !input.disabled; })
				: [node];
			var value = getValue(field.name);
			var fieldValid = true;
			if (field.required && (field.type === "radio" || field.type === "checkbox")) {
				fieldValid = inputs.some(function (input) { return input.checked; });
			}
			if (field.required && field.type === "file") fieldValid = node.files && node.files.length > 0;
			if (value && field.validation === "number") fieldValid = Number.isFinite(Number(value));
			if (value && field.validation === "integer") fieldValid = /^[-+]?\d+$/.test(value);
			if (value && field.validation === "date_mdy") fieldValid = !Number.isNaN(Date.parse(value));
			if (value && field.min !== "") fieldValid = fieldValid && (field.validation === "date_mdy" ? value >= field.min : Number(value) >= Number(field.min));
			if (value && field.max !== "") fieldValid = fieldValid && (field.validation === "date_mdy" ? value <= field.max : Number(value) <= Number(field.max));
			if (error) error.hidden = fieldValid || (!field.required && !value);
			if (!fieldValid) valid = false;
		});
		return valid;
	}

	function updateSubmitState() {
		var missing = [];
		var total = 0;
		definitions.forEach(function (field) {
			if (!field.required || field.type === "descriptive") return;
			var fieldElement = form.querySelector('[data-field-name="' + field.name + '"]');
			// fields hidden by @HIDDEN are exempt; fields hidden by branching still block submit while invisible
			if (!fieldElement || fieldElement.dataset.annotationHidden === "true") return;
			if (fieldElement.hidden) return;
			total += 1;
			var controls = getFieldControls(field.name);
			var fieldMissing = false;
			if (field.type === "radio" || field.type === "checkbox") {
				fieldMissing = !controls.some(function (input) { return input.checked; });
			} else if (field.type === "file") {
				fieldMissing = !controls[0] || !controls[0].files || controls[0].files.length === 0;
			} else {
				fieldMissing = !controls[0] || !controls[0].value.trim();
			}
			if (fieldMissing) missing.push(field.label);
		});
		submitButton.disabled = scanBusy || missing.length > 0;
		if (submitHint) {
			// only nudge the user once they're close (90%+) to finishing, to avoid noise early on
			var nearlyDone = total > 0 && missing.length > 0 && (total - missing.length) / total >= 0.9;
			submitHint.hidden = !nearlyDone;
			submitHint.textContent = nearlyDone ? "Still needed: " + missing.join(", ") : "";
		}
	}

	function pdfValidationMessage(file) {
		if (!file) return "Choose a PDF file.";
		if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return "Choose a PDF file.";
		if (file.size > maxPdfBytes) return "The PDF must be 10 MB or smaller.";
		return "";
	}

	function updateScanButtonState() {
		if (!scanButton) return;
		scanButton.disabled = scanBusy || !definitionsReady || !cloudFlowUrl();
	}

	if (scanner && scanFileInput && scanButton) {
		updateScanButtonState();
		if (!cloudFlowUrl()) setScanStatus("PDF scanning is not configured for this environment.", true);
		scanButton.addEventListener("click", function () {
			if (!scanButton.disabled) scanFileInput.click();
		});
		scanFileInput.addEventListener("change", function () {
			pendingScannedPdf = null;
			if (scanSummary) scanSummary.hidden = true;
			var file = scanFileInput.files[0];
			if (!file) return;
			var validationMessage = pdfValidationMessage(file);
			if (validationMessage) {
				scanFileInput.value = "";
				setScanStatus(validationMessage, true);
			} else if (!cloudFlowUrl()) {
				setScanStatus("PDF scanning is not configured for this environment.", true);
			} else if (!definitionsReady) {
				setScanStatus("Application fields are still loading.", false);
			} else {
				setScanBusy(true);
				setScanStatus("Uploading and scanning " + file.name + "...", false);
				invokeScanFlow(file).then(function (response) {
					var results = populateExtractedFields(extractedEntries(response));
					pendingScannedPdf = file;
					showScanSummary(results);
					setScanStatus("Scan complete. " + results.populated.length + " empty fields populated. Review the form before submitting.", false);
				}).catch(function (error) {
					setScanStatus(error.message || "The PDF could not be scanned.", true);
				}).finally(function () {
					scanFileInput.value = "";
					setScanBusy(false);
				});
			}
		});
	}

	function createRecord(token, payload) {
		return new Promise(function (resolve, reject) {
			var xhr = new XMLHttpRequest();
			xhr.open("POST", "/_api/cr417_hipprecordses");
			xhr.setRequestHeader("Content-Type", "application/json");
			xhr.setRequestHeader("Accept", "application/json");
			xhr.setRequestHeader("__RequestVerificationToken", token);
			xhr.upload.onprogress = function (event) {
				if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
			};
			xhr.onload = function () {
				if (xhr.status >= 200 && xhr.status < 300) resolve();
				else reject(new Error("HTTP " + xhr.status));
			};
			xhr.onerror = function () { reject(new Error("Network error")); };
			xhr.send(JSON.stringify(payload));
		});
	}

	form.addEventListener("submit", function (event) {
		event.preventDefault();
		if (scanBusy) return;
		if (!form.checkValidity() || !validateDictionaryFields()) {
			form.reportValidity();
			return;
		}
		submitButton.disabled = true;
		if (scanButton) scanButton.disabled = true;
		setStatus("Saving record...", false);
		setProgress(0);
		var uploads = collectFileUploads();
		Promise.all([requestToken(), buildAnnotations(uploads)]).then(function (results) {
			var token = results[0];
			var annotations = results[1];
			var payload = { cr417_name: recordName(), cr417_recordjson: JSON.stringify(formData()) };
			if (annotations.length) payload["cr417_hipprecords_Annotations"] = annotations;
			setStatus(uploads.length ? "Uploading attachments..." : "Saving record...", false);
			return createRecord(token, payload);
		}).then(function () {
			form.reset();
			pendingScannedPdf = null;
			if (scanSummary) scanSummary.hidden = true;
			setScanStatus("", false);
			setStatus("Record created successfully.", false);
		}).catch(function (error) {
			setStatus("Unable to create the record. " + error.message, true);
		}).finally(function () { setProgress(null); updateScanButtonState(); updateSubmitState(); });
	});

	fetch(definitionsUrl, { headers: { Accept: "application/json" } })
		.then(function (response) { if (!response.ok) throw new Error("Definitions HTTP " + response.status); return response.json(); })
		.then(function (data) {
			definitions = data;
			definitionsReady = true;
			render();
			updateScanButtonState();
		})
		.catch(function (error) {
			fieldsContainer.replaceChildren();
			setStatus("Application fields could not be loaded. " + error.message, true);
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else {
		boot();
	}
}());
