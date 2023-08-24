// ------------------------------------------
// Requires
// ------------------------------------------
const express = require('express');
const hubspot = require('@hubspot/api-client');
const docusign = require('docusign-esign');
const bodyParser = require('body-parser');
const axios = require('axios');
const cron = require('node-cron');
const {google} = require('googleapis');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const crypto = require('crypto');
const bcrypt = require("bcrypt");
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();
pjson = require('./package.json');


// ------------------------------------------
// Middlewares
// ------------------------------------------
const userMiddleware = require('./middleware/users.js');
const databaseConnector = require('./middleware/database.js');
const databasePool = databaseConnector.createPool();
const database = databaseConnector.getConnection();
const settings = require('./middleware/settings.js');
const mailer = require('./middleware/mailer.js');
const errorlogging = require('./middleware/errorlogging.js');
const { CollectionResponseFolder } = require('@hubspot/api-client/lib/codegen/files');

// ------------------------------------------
// Basic Web Server
// ------------------------------------------
const app = express();

app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');

// ------------------------------------------
//  Helper
// ------------------------------------------
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/public', express.static('public'));
app.use(cors());
app.use(cookieParser());

// ------------------------------------------
// Variables
// ------------------------------------------
var restApi = docusign.ApiClient.RestApi;

// Server Port
const port = process.env.SERVER_PORT;


// ------------------------------------------
// Common Routes
// ------------------------------------------

/** 
 * Route to the administration webinterface
 * 
 */
app.get('/administrator', userMiddleware.isLoggedIn, async (req, res) => {
  res.render(__dirname+"/public/administrator/index.html", {version: pjson.version});
});

/** 
 * Post route to save the settings
 * 
 */
app.post('/savesettings', async (req, res) => {
  if(req.body.sendkey){
    if(req.body.sendkey == "asdn9n34b374b8734vasdv7v73v324"){
      var data = req.body;
      delete data.sendkey;

      Object.keys(data).forEach(async key => {
        if(key != ""){
          var result = await database.awaitQuery(`SELECT * FROM setting_data WHERE setting_name = ?`, [key]);
  
          if(result.length != 0){
            await database.awaitQuery(`UPDATE setting_data SET setting_value = ? WHERE setting_name = ?`, [data[key], key]);
          }else{
            await database.awaitQuery(`INSERT INTO setting_data (setting_name, setting_value) VALUES (?, ?)`, [key, data[key]]);
          }
        }
      });

      res.send(true);
    }else{
      res.send(false);
    }
  }else{
    res.send(false);
  }
});

/** 
 * Post route to get the settings
 * 
 */
app.post('/getsettings', async (req, res) => {
  if(req.body.sendkey){
    if(req.body.sendkey == "asdn9n34b374b8734vasdv7v73v324"){
      var result = await database.awaitQuery(`SELECT * FROM setting_data`);
      res.send(result);
    }else{
      res.send(false);
    }
  }else{
    res.send(false);
  }
});


/** 
 * Post route to get the errors
 * 
 */
app.post('/geterrors', async (req, res) => {
  if(req.body.sendkey){
    if(req.body.sendkey == "asdn9n34b374b8734vasdv7v73v324"){
      var draw = req.body.draw;
      var start = req.body.start;  
      var length = req.body.length;  
      var order_data = req.body.order;
  
      if(typeof order_data == 'undefined' || order_data == ''){
          var column_name = 'error_log.create_date';  
          var column_sort_order = 'desc';
      }else{
          var column_index = req.body.order[0]['column'];
          var column_name = req.body.columns[column_index]['data'];
          var column_sort_order = req.body.order[0]['dir'];
      }
  
      //search data  
      var search_value = req.body.search['value'];
  
      var search_query = `
       AND (error_type LIKE '%${search_value}%' 
        OR error_message LIKE '%${search_value}%'
       )
      `;

      // filter
      var filterAll = req.body.filterAll;
      var filterError = req.body.filterError;
      var filterSuccess = req.body.filterSuccess;
 
      if(filterError == "true"){
        search_query += ` AND error_type LIKE 'error'`;
      }else if(filterSuccess == "true"){
        search_query += ` AND error_type LIKE 'success'`;
      }


      //Total number of records without filtering
      var total_records = await database.awaitQuery(`SELECT COUNT(*) AS Total FROM error_log`);
      total_records = total_records[0].Total;

      var total_records_with_filter = await database.awaitQuery(`SELECT COUNT(*) AS Total FROM error_log WHERE 1 ${search_query}`);
      var total_records_with_filter = total_records_with_filter[0].Total;
  
      var data_arr = [];
      var data_records = await database.awaitQuery(`
      SELECT *, DATE_FORMAT(create_date, "%Y-%m-%d - %H:%i:%s") AS create_date_format FROM error_log 
      WHERE 1 ${search_query} 
      ORDER BY ${column_name} ${column_sort_order} 
      LIMIT ${start}, ${length}
      `);

      data_records.forEach(function(row){
        var errortype = '';
        if(row.error_type == "error"){
          errortype = '<span class="badge badge-danger">Error</span>';
        }else if(row.error_type == "success"){
          errortype = '<span class="badge badge-success">Success</span>';
        }

        var error_message = JSON.parse(row.error_message);

        error_message_show = error_message.title;

        if(error_message.information){
          error_message_show += `
          <!-- Buttons trigger collapse -->
          <a
            class="btn btn-link"
            data-mdb-toggle="collapse"
            href="#collapse`+row.id+`"
            role="button"
            aria-expanded="false"
            aria-controls="collapse`+row.id+`"
          >
            More Information
          </a>


          <!-- Collapsed content -->
          <div class="collapse mt-3" id="collapse`+row.id+`" style="font-size:12px">
          `+error_message.information+`
          </div>
          `;
        }

          data_arr.push({
              'id' : row.id,
              'error_type' : errortype,
              'error_module' : row.error_module,
              'error_message' : error_message_show,
              'create_date' : row.create_date_format,
              'action' : '<button data-element-id="'+row.id+'" type="button" class="btn btn-link btn-sm btn-rounded">Löschen</button>'
          });
      });

      var output = {
        'draw' : draw,
        'recordsTotal' : total_records,
        'recordsFiltered' : total_records_with_filter,
        'data' : data_arr
      };

      res.send(output);
    }else{
      res.send(false);
    }

  }else{
    res.send(false);
  }
});

/** 
 * Post route to delete the errors
 * 
 */
app.post('/deleteerror', async (req, res) => {
  if(req.body.sendkey){
    if(req.body.sendkey == "asdn9n34b374b8734vasdv7v73v324"){
      var data = req.body;
      delete data.sendkey;
      var ids = data.ids; 

      for(var i=0; i<ids.length; i++){
        await database.awaitQuery(`DELETE FROM error_log WHERE id = ?`, [ids[i]]);
      }

      res.send(true);
    }else{
      res.send(false);
    }
  }else{
    res.send(false);
  }
});

/** 
 * Post route to send the test email
 * 
 */
app.post('/testmailer', async (req, res) => {
  if(req.body.sendkey){
    if(req.body.sendkey == "asdn9n34b374b8734vasdv7v73v324"){
      var data = req.body;
      await mailer.sendTestMail(data['mailersentmail'], data['mailertestaddress'], 'Test', 'Testnachricht', 'Testnachricht', data);

      res.send(true);
    }else{
      res.send(false);
    }
  }else{
    res.send(false);
  }
});

// ------------------------------------------
// Login Routes
// ------------------------------------------

/** 
 * Route to the login form
 * 
 */
app.get('/login', async (req, res) => {
  res.sendFile(__dirname+"/public/login/index.html");
});

/** 
 * Post route for the login process
 * 
 */
app.post('/login', async (req, res) => {
  var row = database.getC
  var row = await database.awaitQuery(`SELECT * FROM users WHERE username = ?`, [req.body.username]);

  if(row.length != 0){
    // Check Password
    var passwordCheck = await bcrypt.compare(req.body.password, row[0].password);

    if(passwordCheck){
      const token = jwt.sign({
        username: req.body.username,
        userId: row[0].id
      },
      process.env.JWT_KEY, {
        expiresIn: '7d'
      });

      dayjs.extend(utc)
      dayjs.extend(timezone)
      var date = dayjs().tz("Europe/Berlin").format('YYYY-MM-DD HH:mm:ss');

      await database.awaitQuery(`UPDATE users SET last_login = ? WHERE id = ?`, [date, row[0].id]);

      res.header("auth-token", token);
      res.cookie("token", token, { maxAge: 5000 * 1000 })
     
      return res.send(token);
    }else{
      return res.send(false);
    }
  }else{
    return res.send(false);
  }
});


// ------------------------------------------
// Hubspot Routes
// ------------------------------------------

/** 
 * Route if hubspot app successful added
 * 
 */
app.get('/successHubspotApp', async (req, res) => {
  res.sendFile(__dirname+"/public/successhubspotapp/index.html");
});


/** 
 * Route to register the hubspot app
 * 
 */
app.get('/registerHubSpotApp', async (req, res) => {
  if (req.query.code) {
    // Handle the received code
    const formData = {
      grant_type: 'authorization_code',
      client_id: await settings.getSettingData('hubspotclientid'),
      client_secret: await settings.getSettingData('hubspotclientsecret'),
      redirect_uri: await settings.getSettingData('hubspotredirecturi'),
      code: req.query.code
    };


    axios({
      method: 'post',
      url: 'https://api.hubapi.com/oauth/v1/token',
      data: formData
    })
      .then(async function(response) {
        res.sendFile(__dirname+"/public/successhubspotapp/index.html");
      })
      .catch(function(error) {
        errorlogging.saveError("error", "hubspot", "Error register hubspot app", error);
        console.log(date+" - "+error);
      });
  }
});


/** 
 * Post route for the hubspot webhook
 * 
 */
app.post('/hubspotwebhook', async (req, res) => {
  const hubspotClient = new hubspot.Client({ "accessToken": await settings.getSettingData('hubspotaccesstoken') });

  if(await settings.getSettingData('docusignenvironment') == "true"){
    var docuSignApiClient = new docusign.ApiClient({
      basePath: restApi.BasePath.PRODUCTION
    });
  }else{
    var docuSignApiClient = new docusign.ApiClient({
      basePath: restApi.BasePath.DEMO
    });
  } 

  if(req.headers['x-hubspot-signature']){
    var hash = crypto.createHash('sha256');
    source_string = await settings.getSettingData('hubspotclientsecret') + JSON.stringify(req.body);
    data = hash.update(source_string);
    gen_hash= data.digest('hex');

    dayjs.extend(utc)
    dayjs.extend(timezone)
    var date = dayjs().tz("Europe/Berlin").format('YYYY-MM-DD HH:mm:ss');

    if(gen_hash == req.headers['x-hubspot-signature']){
      var body = req.body[0];


      if (body.subscriptionType) {
      
        // Send DocuSign Contract
        if (body.subscriptionType == "deal.propertyChange" && body.propertyName == "dealstage" && body.propertyValue == "contractsent") {
          var dealId = body.objectId;


          // Lead Deal Data
          var properties = ["deal_gesellschaft", "docusign_contract_status"];
          var associations = ["contact"];

          try {
            const hubspotClient = new hubspot.Client({ "accessToken": await settings.getSettingData('hubspotaccesstoken') });
            var dealData = await hubspotClient.crm.deals.basicApi.getById(dealId, properties, undefined, associations, false, undefined);

            // Check if Contract already sent
            if(dealData.properties['docusign_contract_status'] == null || dealData.properties['docusign_contract_status'] == ""){
              
              // Load Contact Data
              var contactId = dealData.associations.contacts.results[0].id;

              var properties = ["email", "firstname", "lastname", "company", "address", "zip", "city", "iban", "bic", "bankname", "unternehmensform"];
              
              try {
                var contactData = await hubspotClient.crm.contacts.basicApi.getById(contactId, properties, undefined, undefined, false);

                // Check before create contract
                var checkField = true;
                var field_list = [];
                var requireFields = ["email", "firstname", "lastname", "company", "address", "zip", "city", "unternehmensform"];

                for(var i=0; i<requireFields.length; i++){
                  if(contactData.properties[requireFields[i]] == null || contactData.properties[requireFields[i]] == ""){
                    checkField = false;
                    field_list.push(requireFields[i]);
                  }
                }


                if(!checkField){
                  var field_list_string = field_list.join(', ')

                  // Set DocuSign Contract Status
                  var properties = {
                    "docusign_contract_status": "nicht gesendet",
                    "dealstage": "qualifiedtobuy",
                    "docusign_contract_status_fehler": "Ein Pflichtfeld wurde nicht ausgefüllt. ("+field_list_string+")"
                  };
                  var SimplePublicObjectInput = { properties };
                  await hubspotClient.crm.deals.basicApi.update(dealId, SimplePublicObjectInput, undefined);
                }else{
                  // Set DocuSign Contract Status
                  var properties = {
                    "docusign_contract_status": "in Bearbeitung",
                    "docusign_contract_status_fehler": ""
                  };
                  var SimplePublicObjectInput = { properties };
                  await hubspotClient.crm.deals.basicApi.update(dealId, SimplePublicObjectInput, undefined);


                  if(contactData.properties.company == null || contactData.properties.company == ""){
                    contactData.properties.company = contactData.properties.firstname+' '+contactData.properties.lastname;
                  }

                  // Check company type
                  var represent_contract_company = '';

                  if(contactData.properties.unternehmensform == "einzelunternehmen"){
                    represent_contract_company = " (Inhaber/-in)";
                  }

                  // Check Gesellschaft
                  if(dealData.properties['deal_gesellschaft'] == "DIS"){
                    var contractTemplateId = await settings.getSettingData('docusigndiscontracttemplateId');

                    var mailSubject = replacePlaceholder(await settings.getSettingData('docusigndismailsubject'), contactData.properties);

                    var mailBody = replacePlaceholder(await settings.getSettingData('docusigndismailbody'), contactData.properties);

                  }else if(dealData.properties['deal_gesellschaft'] == "DIA"){
                    var contractTemplateId = await settings.getSettingData('docusigndiacontracttemplateId');

                    var mailSubject = replacePlaceholder(await settings.getSettingData('docusigndiamailsubject'), contactData.properties);
                    
                    var mailBody = replacePlaceholder(await settings.getSettingData('docusigndiamailbody'), contactData.properties);
                  }

                  // Sent Contract
                  var row = await database.awaitQuery(`SELECT * FROM access_token WHERE type = "docusign"`);
                  docuSignApiClient.addDefaultHeader('Authorization', 'Bearer ' + row[0].access_token);

                  try {
                    var userInfo = await docuSignApiClient.getUserInfo(row[0].access_token);
                    var accountId = userInfo.accounts[0].accountId;
                    docuSignApiClient.setBasePath(userInfo.accounts[0].baseUri + "/restapi");
                    docusign.Configuration.default.setDefaultApiClient(docuSignApiClient);



                    console.log(date+" - done retrieving account info for user.");

                    // create a new envelope object that we will manage the signature request through
                    var envDef = new docusign.EnvelopeDefinition();
                    envDef.emailSubject = mailSubject;
                    envDef.templateId = contractTemplateId;
                    envDef.emailBlurb = mailBody;


                    // create a template role with a valid templateId and roleName and assign signer info
                    var tRole = new docusign.TemplateRole();
                    tRole.roleName = 'HubSpot';
                    tRole.name = contactData.properties.firstname+' '+contactData.properties.lastname;
                    tRole.email = contactData.properties.email;


                    // Set Template Fields
                    tRole.tabs = new docusign.Tabs();
                    tRole.tabs.textTabs = [];
                    
                    var nTab = new docusign.Text();
                    nTab.tabLabel = "Firma_Contract";
                    nTab.value = contactData.properties.company;
                    tRole.tabs.textTabs.push(nTab);

                    var nTab = new docusign.Text();
                    nTab.tabLabel = "Address_Contract";
                    nTab.value = contactData.properties.address;
                    tRole.tabs.textTabs.push(nTab);

                    var nTab = new docusign.Text();
                    nTab.tabLabel = "Represent_Contract";
                    nTab.value = contactData.properties.firstname+' '+contactData.properties.lastname+represent_contract_company;
                    tRole.tabs.textTabs.push(nTab);

                    var nTab = new docusign.Text();
                    nTab.tabLabel = "Plz_Contract";
                    nTab.value = contactData.properties.zip;
                    tRole.tabs.textTabs.push(nTab);

                    var nTab = new docusign.Text();
                    nTab.tabLabel = "Postalcode_Contract";
                    nTab.value = contactData.properties.zip;
                    tRole.tabs.textTabs.push(nTab);

                    var nTab = new docusign.Text();
                    nTab.tabLabel = "City_Contract";
                    nTab.value = contactData.properties.city;
                    tRole.tabs.textTabs.push(nTab);




                    var nTab = new docusign.Text();
                    nTab.tabLabel = "Firma_Vollmacht";
                    nTab.value = contactData.properties.company;
                    tRole.tabs.textTabs.push(nTab);

                    var nTab = new docusign.Text();
                    nTab.tabLabel = "Address_Vollmacht";
                    nTab.value = contactData.properties.address;
                    tRole.tabs.textTabs.push(nTab);

                    var nTab = new docusign.Text();
                    nTab.tabLabel = "Represent_Vollmacht";
                    nTab.value = contactData.properties.firstname+' '+contactData.properties.lastname+represent_contract_company;
                    tRole.tabs.textTabs.push(nTab);

                    var nTab = new docusign.Text();
                    nTab.tabLabel = "Plz_Vollmacht";
                    nTab.value = contactData.properties.zip;
                    tRole.tabs.textTabs.push(nTab);

                    var nTab = new docusign.Text();
                    nTab.tabLabel = "Postalcode_Vollmacht";
                    nTab.value = contactData.properties.zip;
                    tRole.tabs.textTabs.push(nTab);

                    var nTab = new docusign.Text();
                    nTab.tabLabel = "City_Vollmacht";
                    nTab.value = contactData.properties.city;
                    tRole.tabs.textTabs.push(nTab);




                    var nTab = new docusign.Text();
                    nTab.tabLabel = "IBAN";
                    nTab.value = contactData.properties.iban;
                    tRole.tabs.textTabs.push(nTab);

                    var nTab = new docusign.Text();
                    nTab.tabLabel = "BIC";
                    nTab.value = contactData.properties.bic;
                    tRole.tabs.textTabs.push(nTab);

                    var nTab = new docusign.Text();
                    nTab.tabLabel = "Bank";
                    nTab.value = contactData.properties.bankname;
                    tRole.tabs.textTabs.push(nTab);


                      

                    // create a list of template roles and add our newly created role
                    var templateRolesList = [];
                    templateRolesList.push(tRole);

                    // assign template role(s) to the envelope
                    envDef.templateRoles = templateRolesList;

                    // send the envelope by setting |status| to 'sent'. To save as a draft set to 'created'
                    envDef.status = 'sent';

                    // use the |accountId| we retrieved through the Login API to create the Envelope
                    var accountId = accountId;

                    // instantiate a new EnvelopesApi object
                    var envelopesApi = new docusign.EnvelopesApi();

                    // call the createEnvelope() API
                    envelopesApi.createEnvelope(accountId, { 'envelopeDefinition': envDef }, async function(err, envelopeSummary, response) {
                      if (err) {
                        // Set DocuSign Contract Status
                        var properties = {
                          "docusign_contract_status": "nicht gesendet",
                          "docusign_contract_status_fehler": "Vertrag konnte nicht gesendet werden"
                        };
                        var SimplePublicObjectInput = { properties };
                        await hubspotClient.crm.deals.basicApi.update(dealId, SimplePublicObjectInput, undefined);
              
                        errorlogging.saveError("error", "docusign", "Vertrag konnte nicht gesendet werden ("+dealId+")", err);
                        console.log(date+" - "+err);
                      }else{
                        // Set DocuSign Contract Status
                        var properties = {
                          "docusign_contract_status": "erfolgreich gesendet",
                          "deal_envelopeid": envelopeSummary.envelopeId,
                          "docusign_contract_status_fehler": ""
                        };
                        var SimplePublicObjectInput = { properties };
                        await hubspotClient.crm.deals.basicApi.update(dealId, SimplePublicObjectInput, undefined);

                        errorlogging.saveError("success", "docusign", "Vertrag erfolgreich gesendet ("+envelopeSummary.envelopeId+")", JSON.stringify(envelopeSummary));
                        console.log(date+' - EnvelopeSummary: ' + JSON.stringify(envelopeSummary));
                      }
                    });

                  } catch (err) {
                    errorlogging.saveError("error", "docusign", "Error to load DocuSignAPI", contactData.properties.email);
                    console.log(date+" - "+err);
                  }  
                }                         
              } catch (err) {
                errorlogging.saveError("error", "hubspot", "Error to load the Contact Data ("+contactId+")", "");
                console.log(date+" - "+err);
              }
            
            }else{
              console.log(date+" - Contract already sent");
              errorlogging.saveError("error", "hubspot", "Contrac already sent ("+dealId+")", "");
            }
          } catch (err) {
            errorlogging.saveError("error", "hubspot", "Error to load the Deal Data ("+dealId+")", "");
            console.log(date+" - "+err);
          }

          console.log(date+" - SEND DOCUSIGN CONTRACT");
        }

        // Check Import Error
        if(body.subscriptionType == "contact.propertyChange" && body.propertyName == "export_software" && body.propertyValue == "Fehler"){
          var contactId = body.objectId;

          var properties = ["email", "firstname", "lastname", "company", "address", "zip", "city", "iban", "bic", "bankname", "kontoinhaber"];
          var associations = ["deal"];
                    
          try {
            var contactData = await hubspotClient.crm.contacts.basicApi.getById(contactId, properties, undefined, associations, false);
            var envelopeId = "";
            var dealId = "";

            // Check Contact Deals
            if(contactData.associations.deals.results.length != 0){
              for(var i=contactData.associations.deals.results.length-1; i>=0; i--){
                var contactDealData = contactData.associations.deals.results[i];
              
                var properties = ["dealstage", "deal_envelopeid"];
                var dealData = await hubspotClient.crm.deals.basicApi.getById(contactDealData.id, properties, undefined, undefined, false);

                if(dealData.properties.dealstage == "closedwon"){
                  if(dealData.properties.deal_envelopeid != "" || dealData.properties.deal_envelopeid != null){
                    envelopeId = dealData.properties.deal_envelopeid;
                    dealId = dealData.id;
                  }
                }
              }
            }

            // If Deal exists
            if(envelopeId != ""){
              // Set Contact Data    
              var row = await database.awaitQuery(`SELECT * FROM access_token WHERE type = "docusign"`);
              docuSignApiClient.addDefaultHeader('Authorization', 'Bearer ' + row[0].access_token);

              try {
                var userInfo = await docuSignApiClient.getUserInfo(row[0].access_token);
                var accountId = userInfo.accounts[0].accountId;
                docuSignApiClient.setBasePath(userInfo.accounts[0].baseUri + "/restapi");
                docusign.Configuration.default.setDefaultApiClient(docuSignApiClient);
      
                // instantiate a new EnvelopesApi object
                var envelopesApi = new docusign.EnvelopesApi(docuSignApiClient);
    
    
                var results = await envelopesApi.getFormData(accountId, envelopeId);
    
                var docuSignFormData = results.formData;
                var docuSignFormatData = {};
    
                for(var i=0; i<docuSignFormData.length; i++){
                  docuSignFormatData[docuSignFormData[i]['name']] = docuSignFormData[i]['value'];
                }
                var properties = {};
                var changeValue = false;


                if(contactData.properties.bankname == "" || contactData.properties.bankname == null){
                  properties['bankname'] = docuSignFormatData['Bank'];
                  changeValue = true;
                } 

                if(contactData.properties.bic == "" || contactData.properties.bic == null){
                  properties['bic'] = docuSignFormatData['BIC'];
                  changeValue = true;
                } 

                if(contactData.properties.iban == "" || contactData.properties.iban == null){
                  properties['iban'] = docuSignFormatData['IBAN'];
                  changeValue = true;
                } 

                if(contactData.properties.kontoinhaber == "" || contactData.properties.kontoinhaber == null){
                  properties['kontoinhaber'] = contactData.properties.firstname+" "+contactData.properties.lastname;
                  changeValue = true;
                } 

                if(contactData.properties.mwst == "" || contactData.properties.mwst == null){
                  properties['mwst'] = docuSignFormatData['mwst'];
                } 

                if(changeValue){
                  properties['export_software'] = "Bereit";
                } 

                var SimplePublicObjectInput = { properties };

                if(Object.keys(properties).length != 0){
                  await hubspotClient.crm.contacts.basicApi.update(contactId, SimplePublicObjectInput, undefined);

                  console.log(date+" - Success: Correct contact export error - "+contactData.properties.email);
                  errorlogging.saveError("success", "docusign", "Success: Correct contact export error", contactData.properties.email);
                }
              } catch (err) {
                errorlogging.saveError("error", "docusign", "Error to load DocuSignAPI", err);
                console.log(date+" - "+err);
              }
            }

          } catch (err) {
            errorlogging.saveError("error", "hubspot", "Error to search Contact", err);
            console.log(date+" - "+err);
          }
        }
      }
    }else{
      //errorlogging.saveError("error", "hubspot", "Error to with HMAC Key", "");
      //console.log(date+" - Hubspot hash wrong");
    }
  }
  

  res.send(true);
});


// ------------------------------------------
// DocuSign Routes
// ------------------------------------------

/** 
 * Route if the docusign app successful added
 * 
 */
app.get('/successdocusignapp', async (req, res) => {
  if (req.query.code) {
    // Authorization Token BASE64 => INTEGRATION KEY:SECRET KEY
    var authorization_token = Buffer.from(await settings.getSettingData('docusignintegrationkey')+':'+await settings.getSettingData('docusignsecretkey'), 'utf8').toString('base64')  
  
    dayjs.extend(utc)
    dayjs.extend(timezone)
    var date = dayjs().tz("Europe/Berlin").format('YYYY-MM-DD HH:mm:ss');

    axios({
      method: 'post',
      url: await settings.getSettingData('docusignoauthurl'),
      data: {
        grant_type: 'authorization_code',
        code: req.query.code
      },
      headers: { 'Authorization': 'Basic '+authorization_token },
    })
      .then(async function(response) {
        oAuthToken = response.data;
  
        var row = await database.awaitQuery(`SELECT * FROM access_token WHERE type = "docusign"`);

        if(row.length != 0){
          await database.awaitQuery(`UPDATE access_token SET access_token = ?, refresh_token = ? WHERE type = "docusign"`, [oAuthToken.access_token, oAuthToken.refresh_token]);
        }else{
          await database.awaitQuery(`INSERT INTO access_token (access_token, refresh_token, type) VALUES (?, ?, "docusign")`, [oAuthToken.access_token, oAuthToken.refresh_token]);
        }

      })
      .catch(function(error) {
        errorlogging.saveError("error", "docusign", "Error to load access token", error);
        console.log(date+" - "+error);
      });
  }

  res.sendFile(__dirname+"/public/successdocusignapp/index.html");
});



/** 
 * Cronjob to refresh the docusign token
 * 
 */
cron.schedule('0 */2 * * *', async function() {
  var row = await database.awaitQuery(`SELECT * FROM access_token WHERE type = "docusign"`);

  dayjs.extend(utc)
  dayjs.extend(timezone)
  var date = dayjs().tz("Europe/Berlin").format('YYYY-MM-DD HH:mm:ss');

  // Authorization Token BASE64 => INTEGRATION KEY:SECRET KEY
  var authorization_token = Buffer.from(await settings.getSettingData('docusignintegrationkey')+':'+await settings.getSettingData('docusignsecretkey'), 'utf8').toString('base64')  

  axios({
    method: 'post',
    url: await settings.getSettingData('docusignoauthurl'),
    data: {
      grant_type: 'refresh_token',
      refresh_token: row[0].refresh_token
    },
    headers: { 'Authorization': 'Basic '+authorization_token },
  })
    .then(async function(response) {
      await database.awaitQuery(`UPDATE access_token SET access_token = ?, refresh_token = ? WHERE type = "docusign"`, [response.data.access_token, response.data.refresh_token]);
      console.log(date+" - Refresh Docu Sign Token");
    })
    .catch(function(error) {
      errorlogging.saveError("error", "docusign", "Not possible to refresh the access token", error);
      console.log(date+" - "+error);
    });
    
});



/** 
 * Post route for the docusign webhook
 * 
 */
app.post('/docusignwebhook', async (req, res) => {
  var response = res.req.body;

  const hubspotClient = new hubspot.Client({ "accessToken": await settings.getSettingData('hubspotaccesstoken') });

  if(await settings.getSettingData('docusignenvironment') == "true"){
    var docuSignApiClient = new docusign.ApiClient({
      basePath: restApi.BasePath.PRODUCTION
    });
  }else{
    var docuSignApiClient = new docusign.ApiClient({
      basePath: restApi.BasePath.DEMO
    });
  }


  dayjs.extend(utc)
  dayjs.extend(timezone)
  var date = dayjs().tz("Europe/Berlin").format('YYYY-MM-DD HH:mm:ss');

  if((req.headers['x-docusign-signature-1'] || req.headers['x-docusign-signature-2'] || req.headers['x-docusign-signature-3'] || req.headers['x-docusign-signature-4'])){
    var hmac = crypto.createHmac('sha256', await settings.getSettingData('docusignhmac'));
    hmac.write(JSON.stringify(req.body));
    hmac.end();
    gen_hash = hmac.read().toString('base64');

    if(gen_hash == req.headers['x-docusign-signature-1'] || gen_hash == req.headers['x-docusign-signature-2'] || gen_hash == req.headers['x-docusign-signature-3'] || gen_hash == req.headers['x-docusign-signature-4']){

      if(response.event){      
        // Set DocuSign Envelope Event
        var envelopeId = response.data.envelopeId;

        var row = await database.awaitQuery(`SELECT * FROM docu_sign_events WHERE envelope_id = ? AND event = ?`, [response.data.envelopeId, response.event]);

        if(row.length == 0){
          var PublicObjectSearchRequest = { filterGroups: [{"filters":[{"value":envelopeId, "propertyName":"deal_envelopeid","operator":"EQ"}]}], limit: 1, after: 0 };

          try {
            var apiResponse = await hubspotClient.crm.deals.searchApi.doSearch(PublicObjectSearchRequest);            
            var dealId = apiResponse.results[0].id;

            var properties = {
              "docusign_envelope_status": response.event
            };

            var SimplePublicObjectInput = { properties };
            await hubspotClient.crm.deals.basicApi.update(dealId, SimplePublicObjectInput, undefined);
          } catch (err) {
            console.log(date+" - "+err);
          }  

          await database.awaitQuery(`INSERT INTO docu_sign_events (envelope_id, event) VALUES (?, ?)`, [response.data.envelopeId, response.event]);
        }

        //if(response.retryCount == 0){
            console.log("CHECKED", response);
        
            // Document accepted
            if(response.event == "envelope-completed"){
              var PublicObjectSearchRequest = { filterGroups: [{"filters":[{"value":envelopeId, "propertyName":"deal_envelopeid","operator":"EQ"}]}], limit: 1, after: 0 };
            
              try {
                var apiResponse = await hubspotClient.crm.deals.searchApi.doSearch(PublicObjectSearchRequest);
            
                if(apiResponse.results[0]){
                  var dealId = apiResponse.results[0].id;
                  // Lead Deal Data
                  var properties = ['dealstage'];
                  var associations = ["contact"];

                  try {
                    var dealData = await hubspotClient.crm.deals.basicApi.getById(dealId, properties, undefined, associations, false, undefined);
                  
                    // Load Contact Data
                    var contactId = dealData.associations.contacts.results[0].id;
                
                    var properties = ["export_software", "aktuelle_liste", "bankname", "bic", "iban", "kontoinhaber", "mwst", "firstname", "lastname"];
                  
                    try {
                      var contactData = await hubspotClient.crm.contacts.basicApi.getById(contactId, properties, undefined, undefined, false);
                
                      var docuSignUrl = replacePlaceholder(await settings.getSettingData('docusigncontracturl'), {envelopeId:envelopeId, dealId:dealId});
                      

                      // Set Deal Stage and Deal URL
                      var properties = {
                        "docusign_url": docuSignUrl 
                      };

                      if(dealData.properties.dealstage != "closedwon"){
                        properties['dealstage'] = "closedwon";
                      }
                      var SimplePublicObjectInput = { properties };
                      await hubspotClient.crm.deals.basicApi.update(dealId, SimplePublicObjectInput, undefined);
                
                      // Set Contact Data    
                      var row = await database.awaitQuery(`SELECT * FROM access_token WHERE type = "docusign"`);
                      docuSignApiClient.addDefaultHeader('Authorization', 'Bearer ' + row[0].access_token);

                      try {
                        var userInfo = await docuSignApiClient.getUserInfo(row[0].access_token);
                        var accountId = userInfo.accounts[0].accountId;
                        docuSignApiClient.setBasePath(userInfo.accounts[0].baseUri + "/restapi");
                        docusign.Configuration.default.setDefaultApiClient(docuSignApiClient);
              
                        // instantiate a new EnvelopesApi object
                        var envelopesApi = new docusign.EnvelopesApi(docuSignApiClient);
            
            
                        var results = await envelopesApi.getFormData(accountId, envelopeId);
            
                        var docuSignFormData = results.formData;
                        var docuSignFormatData = {};
            
                        for(var i=0; i<docuSignFormData.length; i++){
                          docuSignFormatData[docuSignFormData[i]['name']] = docuSignFormData[i]['value'];
                        }
            
                        var properties = {};
                        var changeValue = false;

                        if(contactData.properties.bankname == "" || contactData.properties.bankname == null){
                          properties['bankname'] = docuSignFormatData['Bank'];
                          changeValue = true;
                        } 

                        if(contactData.properties.bic == "" || contactData.properties.bic == null){
                          properties['bic'] = docuSignFormatData['BIC'];
                          changeValue = true;
                        } 

                        if(contactData.properties.iban == "" || contactData.properties.iban == null){
                          properties['iban'] = docuSignFormatData['IBAN'];
                          changeValue = true;
                        } 

                        if(contactData.properties.kontoinhaber == "" || contactData.properties.kontoinhaber == null){
                          properties['kontoinhaber'] = contactData.properties.firstname+" "+contactData.properties.lastname;
                          changeValue = true;
                        } 

                        if(contactData.properties.mwst == "" || contactData.properties.mwst == null){
                          properties['mwst'] = docuSignFormatData['mwst'];
                        } 

                        if(contactData.properties.aktuelle_liste != "Abgeschlossen"){
                          properties['aktuelle_liste'] = "Abgeschlossen";
                        } 

                        if(changeValue || contactData.properties.export_software == "" || contactData.properties.export_software == "Nein" || contactData.properties.export_software == null || contactData.properties.export_software == "null"){
                          properties['export_software'] = "Bereit";
                        } 

                        var SimplePublicObjectInput = { properties };

                        if(Object.keys(properties).length != 0){
                          await hubspotClient.crm.contacts.basicApi.update(contactId, SimplePublicObjectInput, undefined);

                          console.log(date+" - Success: Docu Sign Webhook Accepted Contract - "+envelopeId);
                          errorlogging.saveError("success", "docusign", "Success: Docu Sign Webhook Accepted Contract", envelopeId);
                        }

                        res.send(true);
                      } catch (err) {
                        errorlogging.saveError("error", "docusign", "Error to load DocuSignAPI", err);
                        console.log(date+" - "+err);
                      }
        
                    } catch (err) {
                      errorlogging.saveError("error", "hubspot", "Error to load the Contact Data ("+contactId+")", err);
                      console.log(date+" - "+err);
                    }
                  
                  } catch (err) {
                    errorlogging.saveError("error", "hubspot", "Error to load the Deal Data ("+deald+")", err);
                    console.log(date+" - "+err);
                  }
                }      
              } catch (err) {
                errorlogging.saveError("error", "hubspot", "Error to search Deal", err);
                console.log(date+" - "+err);
              }
            }


            // Document not accepted
            if(response.event == "envelope-declined"){
              var PublicObjectSearchRequest = { filterGroups: [{"filters":[{"value":envelopeId, "propertyName":"deal_envelopeid","operator":"EQ"}]}], limit: 1, after: 0 };
            
              try {
                var apiResponse = await hubspotClient.crm.deals.searchApi.doSearch(PublicObjectSearchRequest);

                if(apiResponse.results[0]){
                  var dealId = apiResponse.results[0].id;

                  // Lead Deal Data
                  var properties = ['deal_gesellschaft', 'dealstage', 'docusign_absagedatum', 'docusign_absagedatum'];
                  var associations = ["contact"];
              
                  try {
                    var dealData = await hubspotClient.crm.deals.basicApi.getById(dealId, properties, undefined, associations, false, undefined);
                  
                    // Load Contact Data
                    var contactId = dealData.associations.contacts.results[0].id;
                
                    var properties = ["email", "firstname", "lastname", "company", "address", "zip", "city", "iban", "bic", "bankname"];
                    
                    try {
                      var contactData = await hubspotClient.crm.contacts.basicApi.getById(contactId, properties, undefined, undefined, false);
                
                      // Set Contact Data    
                      var row = await database.awaitQuery(`SELECT * FROM access_token WHERE type = "docusign"`);
                      docuSignApiClient.addDefaultHeader('Authorization', 'Bearer ' + row[0].access_token);

                      try {
                        var userInfo = await docuSignApiClient.getUserInfo(row[0].access_token);
                        var accountId = userInfo.accounts[0].accountId;
                        docuSignApiClient.setBasePath(userInfo.accounts[0].baseUri + "/restapi");
                        docusign.Configuration.default.setDefaultApiClient(docuSignApiClient);

                        // instantiate a new EnvelopesApi object
                        var envelopesApi = new docusign.EnvelopesApi(docuSignApiClient);

                        var results = await envelopesApi.listRecipients(accountId, envelopeId);
                        var declinedReason = results.signers[0].declinedReason; 
                        var declinedDate = results.signers[0].declinedDateTime;

                        if(!results.signers[0].declinedReason){
                          declinedReason = results.signers[1].declinedReason; 
                          declinedDate = results.signers[1].declinedDateTime;
                        }

                        // Set Deal Stage
                        var properties = {};

                        if(dealData.properties.docusign_absagegrund == "" || dealData.properties.docusign_absagegrund == null){
                          properties['docusign_absagegrund'] = declinedReason;
                        } 

                        if(dealData.properties.docusign_absagedatum == "" || dealData.properties.docusign_absagedatum == null){
                          properties['docusign_absagedatum'] = declinedDate;
                        } 

                        if(dealData.properties.dealstage != "closedlost"){
                          properties['dealstage'] = "closedlost";
                        }


                        var SimplePublicObjectInput = { properties };


                        if(Object.keys(properties).length != 0){
                          await hubspotClient.crm.deals.basicApi.update(dealId, SimplePublicObjectInput, undefined);

                          errorlogging.saveError("success", "docusign", "Success: Docu Sign Webhook Canceled Contract", envelopeId);
                          console.log(date+" - Success: Docu Sign Webhook Canceled Contract");
                        }


                        // Create Mail
                        if(dealData.properties.docusign_absagedatum == "" || dealData.properties.docusign_absagedatum == null){
                          if(dealData.properties['deal_gesellschaft'] == "DIS"){
                            var mailSubject = replacePlaceholder(await settings.getSettingData('cancelmaildissubject'), contactData.properties);
                            var mailBody = replacePlaceholder(await settings.getSettingData('cancelmaildistext'), contactData.properties);
                          }else if(dealData.properties['deal_gesellschaft'] == "DIA"){
                            var mailSubject = replacePlaceholder(await settings.getSettingData('cancelmaildiasubject'), contactData.properties);
                            var mailBody = replacePlaceholder(await settings.getSettingData('cancelmaildiatext'), contactData.properties);
                          }

                          // SEND MAIL
                          await mailer.sendMail(await settings.getSettingData('mailersentmail'), contactData.properties.email, mailSubject, mailBody, mailBody);
                        }

                        res.send(true);

                      } catch (err) {
                        errorlogging.saveError("error", "docusign", "Error to load DocuSignAPI", "");
                        console.log(date+" - "+err);
                      }
                    } catch (err) {
                      errorlogging.saveError("error", "hubspot", "Error to load the Contact Data ("+contactId+")", err);
                      console.log(date+" - "+err);
                    }

                  } catch (err) {
                    errorlogging.saveError("error", "hubspot", "Error to load the Deal Data ("+dealId+")", err);
                    console.log(date+" - "+err);
                  } 
                }
              } catch (err) {
                errorlogging.saveError("error", "hubspot", "Error to search the Deal", err);
                console.log(date+" - "+err);
              }
            }
          
        //}else{
        //  res.send(true);
        //}
      }
    
    }else{
      //errorlogging.saveError("error", "docusign", "Error with the HMAC Key", "");
      //console.log(date+" - Error with HMAC");
    }
  }
  
});


/** 
 * Route to load the contracts pdf files
 * 
 */
app.get('/showdocusigndocument', async (req, res) => {
  const hubspotClient = new hubspot.Client({ "accessToken": await settings.getSettingData('hubspotaccesstoken') });

  if(await settings.getSettingData('docusignenvironment') == "true"){
    var docuSignApiClient = new docusign.ApiClient({
      basePath: restApi.BasePath.PRODUCTION
    });
  }else{
    var docuSignApiClient = new docusign.ApiClient({
      basePath: restApi.BasePath.DEMO
    });
  }


  dayjs.extend(utc)
  dayjs.extend(timezone)
  var date = dayjs().tz("Europe/Berlin").format('YYYY-MM-DD HH:mm:ss');

    if(req.query['dealId'] && req.query['envelopeId']){
      var envelopeId = req.query.envelopeId;
      var PublicObjectSearchRequest = { filterGroups: [{"filters":[{"value":envelopeId, "propertyName":"deal_envelopeid","operator":"EQ"}]}], limit: 1, after: 0 };
    
      try {
        var apiResponse = await hubspotClient.crm.deals.searchApi.doSearch(PublicObjectSearchRequest);
        
        if(apiResponse.results[0]){
          var dealId = apiResponse.results[0].id    
          
          if(dealId == req.query['dealId']){   
            // Set Contact Data    
            var row = await database.awaitQuery(`SELECT * FROM access_token WHERE type = "docusign"`);
            docuSignApiClient.addDefaultHeader('Authorization', 'Bearer ' + row[0].access_token);

            try {
              var userInfo = await docuSignApiClient.getUserInfo(row[0].access_token);
              var accountId = userInfo.accounts[0].accountId;
              docuSignApiClient.setBasePath(userInfo.accounts[0].baseUri + "/restapi");
              docusign.Configuration.default.setDefaultApiClient(docuSignApiClient);
               
              // instantiate a new EnvelopesApi object
              var envelopesApi = new docusign.EnvelopesApi();
      
      
              envelopesApi.getDocument(accountId, envelopeId, 'combined')
              .then(function (pdfBytes) {
                if (pdfBytes) {
                  try {
                    // download the document pdf
                    const data = Buffer.from(pdfBytes, 'binary');
      
                    res.setHeader('Content-Type', 'application/pdf')
                    res.setHeader('Content-Length', data.length)
                    return res.end(data)
                  } catch (ex) {
                    console.log(date+' - Exception: ' + ex);
                    return res.sendFile(__dirname+"/public/showdocusigndocument/index.html");
                  }
                }
              })
              .catch(function (error) {
                if (error) {
                  console.log(date+" - "+error);
                  return res.sendFile(__dirname+"/public/showdocusigndocument/index.html");
                }
              });
            } catch (err) {
              errorlogging.saveError("error", "docusign", "Error to load DocuSignAPI", "");
              console.log(date+" - "+err);
            }
  
          }else{
            console.log(date+" - error");
            res.sendFile(__dirname+"/public/showdocusigndocument/index.html");
          }
        }else{
          console.log(date+" - error");
          res.sendFile(__dirname+"/public/showdocusigndocument/index.html");
        }
      } catch (err) {
        console.log(date+" - "+err);
        res.sendFile(__dirname+"/public/showdocusigndocument/index.html");
      }
    }
});


// ------------------------------------------
// Salty brands
// ------------------------------------------

/** 
 * Cronjob to import the saltybrands lead from googlesheets
 * 
 */
cron.schedule('*/5 * * * *', async function() {
  const hubspotClient = new hubspot.Client({ "accessToken": await settings.getSettingData('hubspotaccesstoken') });

  dayjs.extend(utc)
  dayjs.extend(timezone)
  var date = dayjs().tz("Europe/Berlin").format('YYYY-MM-DD HH:mm:ss');

  var creds = JSON.parse(await settings.getSettingData('googlesheetprivatekey'));

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });

  // Acquire an auth client, and bind it to all future calls
  const authClient = await auth.getClient();
  google.options({auth: authClient});


  const sheets = google.sheets({version: 'v4', auth});

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: await settings.getSettingData('googlesheetid'),
    range: "LinkedIn"
  });

  if(res.data){
    var rows = res.data.values;

    if(rows.length != 0){
      for(var i=6; i<rows.length;i++){
        var obj = rows[5].reduce((acc, cur, index) => {
          acc[cur] = rows[i][index];
          return acc;
        }, {});


        if(obj['Import'] == null && obj['E-Mail'] != null){
          // PHONE
          var phone = obj['Telefonnummer'];
    
          if(phone != ""){
            if(!phone.includes("+")){
              if(phone.startsWith('00')){
                phone = phone.slice(2);
                phone = "+"+phone;
              }else if(phone.startsWith('0')){
                phone = phone.slice(1);
                phone = "+49"+phone;
              }
            }
          }
    
          var properties = {
              "company": obj['Firmenname'],
              "email": obj['E-Mail'].trim(),
              "firstname": obj['Vorname'],
              "lastname": obj['Nachname'],
              "phone": phone,
              "country": "Deutschland",
              "aktuelle_liste": "Neue Leads",
              "lead_typ": "Einfacher Lead",
              "lead_anbieter": "SaltyBrands",
              "lead_quelle": "Gekaufte Leads: SaltyBrands",
              "hs_lead_status": "NEW",
              "saltybrands__haben_sie_offene_forderungen_": obj['Haben Sie offene Forderungen?'],
              "saltybrands__wie_viele_transaktionen_haben_sie_im_monat_": obj['Wie viele offene Forderungen haben Sie im Monat?']
            };
    
          var SimplePublicObjectInput = { properties };

          try {
            var apiResponse = await hubspotClient.crm.contacts.basicApi.create(SimplePublicObjectInput); 

            try {
              var response = (await sheets.spreadsheets.values.update({
                spreadsheetId: await settings.getSettingData('googlesheetid'),
                range: "LinkedIn!W"+(i+1),
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [["success"]] },
              })).data;
  
              console.log(JSON.stringify(response, null, 2));
  
            } catch (err) {
              console.error(err);
            }

            console.log(date+" - Success: Google Sheet SaltyBrands Import");
            errorlogging.saveError("success", "saltybrands", "Google Sheet SaltyBrands Import. ("+obj['E-Mail']+")", "");
          } catch (err) {
            if(err.body['message'].includes("Contact already exists")){
              var response = (await sheets.spreadsheets.values.update({
                spreadsheetId: await settings.getSettingData('googlesheetid'),
                range: "LinkedIn!W"+(i+1),
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [["success"]] },
              })).data;

              errorlogging.saveError("error", "saltybrands", "Contact already exists. ("+obj['E-Mail']+")", "");
            }else{
              errorlogging.saveError("error", "saltybrands", "Not possibe to import. ("+obj['E-Mail']+")", err.body['message']);
            }
          }        
        }
      }
    }
  }else{
    errorlogging.saveError("error", "saltybrands", "Not possible to open google sheet ", "");
  }
});






/** 
 * Check wrong Hubspot DocuSign Contracts
 * 
 */
cron.schedule('0 * * * *', async function() {
  const hubspotClient = new hubspot.Client({ "accessToken": await settings.getSettingData('hubspotaccesstoken') });

  if(await settings.getSettingData('docusignenvironment') == "true"){
    var docuSignApiClient = new docusign.ApiClient({
      basePath: restApi.BasePath.PRODUCTION
    });
  }else{
    var docuSignApiClient = new docusign.ApiClient({
      basePath: restApi.BasePath.DEMO
    });
  }


  // Check Deal Envelope Status  
  dayjs.extend(utc)
  dayjs.extend(timezone)

  var date = dayjs().subtract(7, 'days').tz("Europe/Berlin").format('MM/DD/YYYY');

  var row = await database.awaitQuery(`SELECT * FROM access_token WHERE type = "docusign"`);
  docuSignApiClient.addDefaultHeader('Authorization', 'Bearer ' + row[0].access_token);

  try {
    var userInfo = await docuSignApiClient.getUserInfo(row[0].access_token);
    var accountId = userInfo.accounts[0].accountId;
    docuSignApiClient.setBasePath(userInfo.accounts[0].baseUri + "/restapi");
    docusign.Configuration.default.setDefaultApiClient(docuSignApiClient);
    var envelopesApi = new docusign.EnvelopesApi(docuSignApiClient);

    let envelopesInformation = await envelopesApi.listStatusChanges(accountId, {fromDate:date});
              
    for(var i=0; i<envelopesInformation.totalSetSize; i++){
      var PublicObjectSearchRequest = { filterGroups: [{"filters":[{"value": envelopesInformation.envelopes[i].envelopeId, "propertyName":"deal_envelopeid","operator":"EQ"}]}], properties:['docusign_url', 'deal_envelopeid', 'dealname', 'docusign_envelope_status'], limit: 100, after: 0 };
      var apiResponse = await hubspotClient.crm.deals.searchApi.doSearch(PublicObjectSearchRequest);   

      if(typeof apiResponse.results[0] !== 'undefined'){
        if(apiResponse.results[0].properties.docusign_envelope_status != "envelope-"+envelopesInformation.envelopes[i].status){
          // Set Deal Envelope Status
          var properties = {
            "docusign_envelope_status": "envelope-"+envelopesInformation.envelopes[i].status
          };

          var SimplePublicObjectInput = { properties };
          await hubspotClient.crm.deals.basicApi.update(apiResponse.results[0].id, SimplePublicObjectInput, undefined);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }catch(err){
    console.log(err);
  }



  // Check Deals with no DocuSign URL
  var PublicObjectSearchRequest = { filterGroups: [{"filters":[{"value": "envelope-completed", "propertyName":"docusign_envelope_status","operator":"EQ"}, {"propertyName":"deal_envelopeid","operator":"HAS_PROPERTY"}, {"propertyName":"docusign_url","operator":"NOT_HAS_PROPERTY"}]}], properties:['docusign_url', 'deal_envelopeid', 'dealname'], limit: 100, after: 0 };

  try {
    var apiResponse = await hubspotClient.crm.deals.searchApi.doSearch(PublicObjectSearchRequest);    
       
    dayjs.extend(utc)
    dayjs.extend(timezone)
    var date = dayjs().tz("Europe/Berlin").format('YYYY-MM-DD HH:mm:ss');
    

    for(var i=0; i<apiResponse.total;i++){
      var dealId = apiResponse.results[i].id;
      var envelopeId = apiResponse.results[i].properties.deal_envelopeid;
      // Lead Deal Data
      var properties = ['dealstage'];
      var associations = ["contact"];
   
      try {
        var dealData = await hubspotClient.crm.deals.basicApi.getById(dealId, properties, undefined, associations, false, undefined);
      
        // Load Contact Data
        var contactId = dealData.associations.contacts.results[0].id;
    
        var properties = ["export_software", "aktuelle_liste", "bankname", "bic", "iban", "kontoinhaber", "mwst", "firstname", "lastname"];

        try {
          var contactData = await hubspotClient.crm.contacts.basicApi.getById(contactId, properties, undefined, undefined, false);
    
          var docuSignUrl = replacePlaceholder(await settings.getSettingData('docusigncontracturl'), {envelopeId:envelopeId, dealId:dealId});


          // Set Deal Stage and Deal URL
          var properties = {
            "docusign_url": docuSignUrl 
          };

          if(dealData.properties.dealstage != "closedwon"){
            properties['dealstage'] = "closedwon";
          }

          var SimplePublicObjectInput = { properties };
          await hubspotClient.crm.deals.basicApi.update(dealId, SimplePublicObjectInput, undefined);
    
          // Set Contact Data    
          var row = await database.awaitQuery(`SELECT * FROM access_token WHERE type = "docusign"`);
          docuSignApiClient.addDefaultHeader('Authorization', 'Bearer ' + row[0].access_token);

          try {
            var userInfo = await docuSignApiClient.getUserInfo(row[0].access_token);
            var accountId = userInfo.accounts[0].accountId;
            docuSignApiClient.setBasePath(userInfo.accounts[0].baseUri + "/restapi");
            docusign.Configuration.default.setDefaultApiClient(docuSignApiClient);

            // instantiate a new EnvelopesApi object
            var envelopesApi = new docusign.EnvelopesApi(docuSignApiClient);


            var results = await envelopesApi.getFormData(accountId, envelopeId);

            var docuSignFormData = results.formData;
            var docuSignFormatData = {};

            for(var a=0; a<docuSignFormData.length; a++){
              docuSignFormatData[docuSignFormData[a]['name']] = docuSignFormData[a]['value'];
            }

            var properties = {};
            var changeValue = false;

            if(contactData.properties.bankname == "" || contactData.properties.bankname == null){
              properties['bankname'] = docuSignFormatData['Bank'];
              changeValue = true;
            } 

            if(contactData.properties.bic == "" || contactData.properties.bic == null){
              properties['bic'] = docuSignFormatData['BIC'];
              changeValue = true;
            } 

            if(contactData.properties.iban == "" || contactData.properties.iban == null){
              properties['iban'] = docuSignFormatData['IBAN'];
              changeValue = true;
            } 

            if(contactData.properties.kontoinhaber == "" || contactData.properties.kontoinhaber == null){
              properties['kontoinhaber'] = contactData.properties.firstname+" "+contactData.properties.lastname;
              changeValue = true;
            } 

            if(contactData.properties.mwst == "" || contactData.properties.mwst == null){
              properties['mwst'] = docuSignFormatData['mwst'];
            } 

            if(contactData.properties.aktuelle_liste != "Abgeschlossen"){
              properties['aktuelle_liste'] = "Abgeschlossen";
            } 

            if(changeValue || contactData.properties.export_software == "" || contactData.properties.export_software == "Nein" || contactData.properties.export_software == null || contactData.properties.export_software == "null"){
              properties['export_software'] = "Bereit";
            } 

            var SimplePublicObjectInput = { properties };

            if(Object.keys(properties).length != 0){
              await hubspotClient.crm.contacts.basicApi.update(contactId, SimplePublicObjectInput, undefined);

              console.log(date+" - Success: Docu Sign Checker Accepted Contract - "+envelopeId);
              errorlogging.saveError("success", "docusign", "Success: Docu Sign Checker Accepted Contract", envelopeId);
            }
          } catch (err) {
            errorlogging.saveError("error", "docusign", "Error to load DocuSignAPI", err);
            console.log(date+" - "+err);
          }         

        } catch (err) {
          errorlogging.saveError("error", "hubspot", "Error to load the Contact Data ("+contactId+")", err);
          console.log(date+" - "+err);
        }
        
      
      } catch (err) {
        errorlogging.saveError("error", "hubspot", "Error to load the Deal Data ("+deald+")", err);
        console.log(date+" - "+err);
      }      
    }

  } catch (err) {
    console.log(err);
  }  

});


// ------------------------------------------
// Module Function
// ------------------------------------------

/**
 * Function to replace placeholders in a string Placeholder-Format: {key}
 * 
 * @param {string} text 
 * @param {object} data 
 * @returns {string}
 */
function replacePlaceholder(text, data){
  Object.keys(data).forEach(key => {
    text = text.replaceAll('{'+key+'}', data[key]);
  });

  return text;
}

// ------------------------------------------
// Start Server
// ------------------------------------------
app.listen(
  port,
  () => console.log(`Start server on Port ${port}`)
);