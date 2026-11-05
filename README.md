# HIPP

A Microsoft Power Pages site for submitting HIPP requests, prefilling application
fields from PDFs, browsing submitted records, and reviewing extracted document
values stored in Microsoft Dataverse.

## Features

- **Dictionary-driven applications:** the Add Record page builds form sections,
  controls, choices, defaults, required fields, and branching rules from a shared
  JSON field dictionary.
- **PDF prefill:** signed-in users can scan a completed PDF through a configured
  Power Automate cloud flow. Only empty fields are populated; existing values are
  preserved, and ambiguous or invalid results are reported for review.
- **Record submission:** application values are stored as JSON, with file
  attachments created alongside the parent record.
- **Record browsing:** the Home page loads records in pages of 50 and displays
  grouped application data with readable field and choice labels.
- **Document review:** extracted fields below 80% confidence appear in an
  editable document tree. Saving a field updates its extracted JSON in Dataverse.
- **PDF highlighting:** PDF.js renders document pages with source polygon
  highlights, or text highlights when polygon data is unavailable.
- **Keyboard navigation:** viewer tabs, record lists, and document trees support
  keyboard interaction and ARIA states.

## Repository structure

| Location | Purpose |
| --- | --- |
| `web-pages/` | Page metadata, HTML/Liquid content, JavaScript, and page-specific CSS. |
| `web-pages/*/content-pages/` | Localized page content, including the active `en-US` application code. |
| `web-templates/` | Shared Liquid templates, navigation, footer, search, and embedded chat. |
| `web-files/` | Shared styles, images, the JSON field dictionary, and the source CSV. |
| `content-snippets/` | Localized text and reusable content fragments. |
| `page-templates/` | Page-to-template configuration. |
| `table-permissions/` | Dataverse table access assigned to portal web roles. |
| `cloud-flow-consumer/` | Portal registration and role bindings for the PDF scanning flow. |
| `weblink-sets/` | Navigation link definitions. |
| `sitesetting.yml`, `webrole.yml`, `website.yml` | Site settings, roles, and website metadata. |
| `.portalconfig/` | Power Pages CLI synchronization metadata. |

### Main implementation files

- [Add Record JavaScript](web-pages/add-record/content-pages/Add-Record.en-US.webpage.custom_javascript.js)
  handles form rendering, validation, PDF scanning, attachments, and submission.
- [Add Record markup](web-pages/add-record/content-pages/Add-Record.en-US.webpage.copy.html)
  defines the form and scanner elements and injects the cloud flow setting.
- [Home page](web-pages/home/content-pages/Home.en-US.webpage.copy.html)
  contains the document query, viewer styles, record browser, editable tree, and
  inline PDF viewer JavaScript.
- [Field dictionary](web-files/hipp-field-definitions.json) supplies the runtime
  field definitions shared by both pages.
- [Shared theme](web-files/theme.css) defines site-wide styling.

Other pages include Search, Profile, Access Denied, Page Not Found, and View
Document. The current View Document content is a layout placeholder; the
implemented document viewer is on Home.

## Runtime and prerequisites

This repository is a Power Pages website export, not a standalone Node.js
application. There is no repository-defined package installation, build, or test
command. Liquid, portal authentication, and `/_api/` requests require a running
Power Pages site; opening the HTML locally does not reproduce those services.

To run the complete site, provide:

1. A Power Pages website connected to a Dataverse environment.
2. The custom tables, columns, and attachment relationship used by the code.
3. Appropriate site settings, table permissions, and user web roles.
4. A Power Automate flow registered as a portal cloud flow consumer for PDF
   extraction.
5. Browser access to the PDF.js library and matching worker loaded from cdnjs.

### Dataverse dependencies

| Table | Values used by the site |
| --- | --- |
| `cr417_hipprecords` | Record ID, name, application JSON, and creation date. |
| `cr417_annotatedpdf` | Document ID, PDF file/name, SharePoint URL, extracted JSON, and the query's ordering column. |
| `annotation` | Attachment subject, filename, MIME type, and Base64 document body. |

The application calls `/_api/cr417_hipprecordses` and
`/_api/cr417_annotatedpdfs`. Attachments use the
`cr417_hipprecords_Annotations` navigation property for deep insertion with the
parent record. The website export does not provision the custom Dataverse schema
or contain the cloud flow implementation; deploy those dependencies separately.

## Configuration

Review [site settings](sitesetting.yml),
[table permissions](table-permissions/), and [web roles](webrole.yml) before
deploying to another environment.

- `HIPP/ContentUnderstandingFlowId` identifies the PDF scanning flow. Align it
  with the target environment's cloud flow consumer registration.
- `Webapi/cr417_hipprecords/enabled` and its `/fields` setting control record API
  exposure.
- `Webapi/cr417_annotatedpdf/enabled` and its `/fields` setting control document
  API exposure.
- `Webapi/annotation/enabled` and its `/fields` setting control attachment API
  exposure.
- The exported table permissions and flow consumer bind to **Authenticated
  Users** and **Administrators**. Confirm that their access scopes match the
  intended audience; do not rely on client-side visibility as authorization.

The PDF scanner accepts PDFs up to **10 MB**. It sends `eventData` containing
`text` (filename) and `text_1` (Base64 content). The response parser accepts
supported field results or layout output, including `ExtractionResult` and
`returnjson` wrappers. Confirm this contract when configuring the external flow.

Keep credentials and environment secrets out of source control. Use the target
environment's supported configuration mechanisms for authentication secrets.

## Editing and publishing

1. Work from a current website export and retain the existing IDs and localized
   page relationships.
2. Edit the relevant `en-US` content files rather than assuming root page files
   contain the active implementation.
3. Keep field order, labels, choices, validation rules, and branching logic in
   `hipp-field-definitions.json`. The included CSV is a source reference; runtime
   pages fetch the JSON file, not the CSV.
4. Validate changes in a non-production Power Pages environment before release.
5. Publish using your established Power Pages workflow or the Microsoft Power
   Platform CLI.

For CLI publishing, install the Power Platform CLI, authenticate to the intended
Dataverse environment, and confirm the active authentication profile:

```powershell
pac auth create --environment "<Dataverse environment URL>"
pac auth list
pac pages list
pac pages upload --help
pac pages upload --path "."
```

Run the upload from this repository directory only after checking the target
environment, permissions, and CLI options for the website's data model. Uploading
changes the connected website; it does not create the custom tables or scanning
flow. Check the published site and refresh its configuration/cache through your
normal administrative workflow if old content remains visible.

## Validation checklist

- Load Add Record and confirm the dictionary renders in the expected order.
- Change correspondence type and household values to exercise branching rules.
- Check required choices, numeric limits, date validation, and submit availability.
- Scan a valid PDF and confirm existing values are preserved and the summary
  explains skipped or invalid entries.
- Reject a non-PDF file and a PDF larger than 10 MB.
- Submit a request with attachments and verify the parent record and annotations.
- Browse records, load another page, and check field and choice display labels.
- Open an extracted document, verify highlighting, edit a field, save it, and
  reload to confirm persistence.
- Exercise tab, record list, and document tree keyboard navigation.
- Verify unauthorized sessions cannot perform protected writes or trigger scans.

All function declarations and callbacks are documented in **English**, with each
function description limited to **200 characters**. Keep comments accurate when
changing behavior and preserve existing third-party notices.

## Troubleshooting

| Symptom | Checks |
| --- | --- |
| Application fields do not load | Confirm `/hipp-field-definitions.json` is published and returns valid JSON. |
| PDF scanning is unavailable | Check sign-in, flow ID, consumer registration, role bindings, and flow availability. |
| API requests return 401 or 403 | Check the session, assigned roles, table permissions, enabled APIs, and exposed columns. |
| An attachment is rejected | Confirm the annotation permissions and parent navigation property used for deep insertion. |
| A PDF does not render | Check the PDF.js CDN and worker, document URL, file access, and cross-origin restrictions. |
| Extracted fields are absent | Check extracted JSON validity, field values, and the viewer's below-80% confidence filter. |
| Saved changes fail or disappear | Inspect the write response, verification token, document permissions, and target record. |