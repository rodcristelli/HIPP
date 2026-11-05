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

## Creating the Dataverse tables and columns

Use these instructions in a development environment before publishing the site.
They describe a **compatible schema derived from the website code**, not an
export of the existing environment's table metadata. Suggested lengths and types
for non-JSON fields should be checked against your organization's requirements.
If you already have a solution containing these tables, import it instead of
recreating them.

### 1. Create a solution with the correct publisher

1. Open [Power Apps](https://make.powerapps.com) and select the same Dataverse
   environment that hosts your Power Pages website.
2. Use an account allowed to create tables and solutions, such as a System
   Customizer or System Administrator.
3. Open **Solutions**, create an unmanaged development solution, and select or
   create a publisher whose customization prefix is **`cr417`**.
4. Create all custom tables and columns from inside this solution. Expand the
   advanced properties before saving to check their schema names.

The code depends on exact **logical names**, not display names. Table and column
schema names cannot be renamed after creation. If you use another prefix, update
the JavaScript, Liquid queries, API site settings, and table permission definitions
consistently; changing display labels alone is not sufficient.

### 2. Create the HIPP Records table

Inside the solution, select **New > Table** and use the advanced properties
option. Create a **Standard** table with display name **HIPP Record** and plural
display name **HIPP Records**. Set the schema-name suffix to `hipprecords` under
the `cr417` publisher and confirm the resulting logical name is
**`cr417_hipprecords`**.

Choose **User or team** ownership if records need owner-based administration.
Ownership is a design choice, not a website requirement; Power Pages table
permissions still determine portal access. Enable **Attachments** (notes and
files) so records can use Dataverse annotations.

Configure the primary name column before saving. Then open **Columns > New
column** to add the application JSON column:

| Display name | Logical name | Data type | Configuration |
| --- | --- | --- | --- |
| Name | `cr417_name` | Single line of text | Primary name column; suggested maximum length: 250 characters. The application supplies a name and timestamp. |
| Record JSON | `cr417_recordjson` | Multiple lines of text / Multiline Text | Plain text, simple behavior; set maximum length to 1,048,576 characters to accommodate application JSON. |
| HIPP Record ID | `cr417_hipprecordsid` | Unique identifier | Primary key generated by Dataverse; verify its name, do not add a second ID column. |
| Created On | `createdon` | Date and time | System-generated; do not create or populate it manually. |

For JSON storage, use **Multiline Text**, not the smaller **Text Area** format or
rich text. Dataverse does not need a separate column for every application field:
keys such as `p_first_name`, `h1_dob`, and insurance fields are stored inside
`cr417_recordjson`. Their rendering and validation are defined in the
[JSON field dictionary](web-files/hipp-field-definitions.json).

Do not make additional custom columns mandatory unless every record-creation
path supplies them. The current website sends the record name, application JSON,
and optional related annotations.

### 3. Create the Annotated PDF table

Create another **Standard** table in the same solution, with display name
**Annotated PDF**, plural display name **Annotated PDFs**, and schema-name suffix
`annotatedpdf`. Confirm the logical name is **`cr417_annotatedpdf`**.

Configure a primary name column, for example **Name** (`cr417_name`), for
administrative use. The website does not reference this table's primary name
column, so preserve the actual primary name if importing an existing schema.
Add the following columns through **Columns > New column**:

| Display name | Logical name | Data type | Configuration |
| --- | --- | --- | --- |
| Extracted JSON | `cr417_extractedjson` | Multiple lines of text / Multiline Text | Plain text, simple behavior; suggested maximum length: 1,048,576 characters. Stores extracted field values, confidence, and source geometry. |
| PDF File | `cr417_pdffile` | File | Set a maximum size appropriate for your documents; at least 10,240 KB if storing PDFs accepted by the 10 MB scanner. |
| SharePoint URL | `cr417_sharepointurl` | Single line of text, URL format | Optional; suggested maximum length: 2,000 characters. The browser must be able to fetch the referenced PDF. |
| Display Order | `cr417_field1` | Whole number | Suggested for a new schema; the Home page sorts documents by this column. Populate it for predictable ordering. |
| Annotated PDF ID | `cr417_annotatedpdfid` | Unique identifier | Primary key generated by Dataverse; verify its name rather than creating a duplicate. |
| PDF File Name | `cr417_pdffile_name` | System-generated text | Read-only companion of the File column; created automatically by Dataverse and not shown in the column designer. Do not create it manually. |

The repository references `cr417_field1` for sorting but does not establish its
original data type. If that column already exists, keep its existing compatible
type; the Whole number type above is a recommendation for a new environment.

The Home page requires non-null extracted JSON to list a document. It uses the
SharePoint URL when present and otherwise downloads `cr417_pdffile` through the
portal API. Upload File column content using a supported file upload operation;
do not send Base64 text as an ordinary value in the record's File column.

### 4. Verify Notes and the attachment relationship

The **Note** table (`annotation`) is built into Dataverse. Do not create a custom
replacement table or custom copies of `subject`, `filename`, `mimetype`, or
`documentbody`.

Enabling attachments on HIPP Records should create its relationship to Notes.
After saving and publishing:

1. Open the HIPP Records table's **Relationships** and locate the one-to-many
   relationship to Note.
2. Verify the **collection-valued navigation property** is
   `cr417_hipprecords_Annotations`. This exact, case-sensitive name is the array
   property used by the site's deep-insert payload.
3. Verify the Note-side navigation property for the parent's Regarding lookup is
   `objectid_cr417_hipprecords`, as referenced by the annotation API field setting.
4. If generated navigation names differ, use the actual metadata names in both
   the payload and relevant site settings. Do not assume a relationship display
   name is also its API navigation name.
5. Configure annotation **Create** and **Append**, and parent record **Create**
   and **Append To**, through the appropriate portal table permissions and roles.
   Review the exported permissions before granting any broader access.

The current implementation creates notes together with their parent record; it
does not create a separate application-table lookup for each uploaded file.
Check the environment's Notes attachment size limit and blocked extensions as
well: a File column size setting does not control Note attachments. To retain
scanned PDFs as notes, the Notes limit must also accommodate the accepted PDF
size, and request limits must accommodate the Base64 payload.

No direct HIPP Record-to-Annotated PDF relationship is required by the current
website code. Add one only if a separately designed ingestion or business process
needs it.

### 5. Verify the API names and publish the schema

Save the columns and **Publish all customizations** in your solution. Using an
authenticated Dataverse API client, inspect the metadata on your **Dataverse
organization URL**, not the Power Pages `/_api/` endpoint:

```http
GET <Dataverse organization URL>/api/data/v9.2/EntityDefinitions(LogicalName='cr417_hipprecords')?$select=LogicalName,PrimaryIdAttribute,PrimaryNameAttribute,EntitySetName
GET <Dataverse organization URL>/api/data/v9.2/EntityDefinitions(LogicalName='cr417_annotatedpdf')?$select=LogicalName,PrimaryIdAttribute,PrimaryNameAttribute,EntitySetName
GET <Dataverse organization URL>/api/data/v9.2/EntityDefinitions(LogicalName='cr417_hipprecords')/OneToManyRelationships?$select=SchemaName,ReferencedEntityNavigationPropertyName,ReferencingEntityNavigationPropertyName&$filter=ReferencingEntity eq 'annotation'
```

The website expects the record entity set to be **`cr417_hipprecordses`** and the
document entity set to be **`cr417_annotatedpdfs`**. These are API collection names,
not table logical names or plural display labels. If metadata returns different
entity set names, update the site's API URLs consistently.

Then configure the API field allowlists and portal permissions described below.
The document's `cr417_sharepointurl` and `cr417_field1` columns are read by Liquid
FetchXML; they must exist even though they are not in the current document API
field allowlist. Table creation alone does not grant website users access.

### 6. Test the schema and package it for other environments

- Create a HIPP Record with a sample name and a small JSON object; verify the Home
  page can list and render it.
- Create an Annotated PDF row with a PDF file or accessible URL and extracted
  JSON containing a `fields` object. Use a nonempty field with confidence below
  `0.8` to exercise the editable document tree.
- Save an extracted value through the website and verify the JSON update persists.
- Submit an application with an attachment and confirm the Note's Regarding
  lookup points to the new HIPP Record.
- Test access with the intended portal roles, not only a Dataverse administrator.
- Export the Dataverse solution with its tables, columns, and relationships for
  subsequent environments. Deploy the website export and cloud flow separately.

Microsoft references:
[table creation](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/create-edit-entities-portal),
[column creation](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/create-edit-field-portal),
[column types and text limits](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/types-of-fields),
[File columns and automatic filename columns](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/file-column-data),
[metadata queries](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query-metadata-web-api),
and [Power Pages record and annotation creation](https://learn.microsoft.com/en-us/power-pages/configure/write-update-delete-operations).

## Configuration

Review [site settings](sitesetting.yml),
[table permissions](table-permissions/), and [web roles](webrole.yml) before
deploying to another environment.

The shared page header uses the local `generic-logo.png` web file. Customize
the `Logo URL` and `Logo alt text` content snippets to change its image and
accessible description.

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