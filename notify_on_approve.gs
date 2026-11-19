/**
 * Official Creations Lead Automation -- instant approval notifications.
 *
 * Fires the moment a lead's "Approve" checkbox is ticked in the Leads
 * sheet (via the dashboard OR a direct edit in Google Sheets), instead
 * of waiting for the 5-minute notifier.py poll. Sends the same Slack
 * and Telegram messages notifier.py sends, and marks the same
 * "Slack Notified" / "Telegram Notified" columns, so the two systems
 * never double-send in the normal case: whichever gets there first
 * marks the column TRUE, and the other sees that and skips it.
 *
 * (In the rare case an edit happens in the same 1-2 second window as
 * the GitHub Action's 5-minute poll, both could fire once before
 * either write lands -- a possible duplicate ping, not a duplicate
 * Lead or data corruption. This script does not change that risk,
 * just makes the normal case instant instead of waiting up to 5 min.)
 *
 * SETUP (one-time, inside this spreadsheet):
 *
 * 1. Open this Google Sheet, then Extensions -> Apps Script.
 * 2. Delete any placeholder code and paste this whole file in.
 * 3. Project Settings (gear icon, left sidebar) -> Script Properties
 *    -> Add script property, for each of:
 *      SLACK_BOT_TOKEN
 *      SLACK_CHANNEL_ID
 *      TELEGRAM_BOT_TOKEN
 *      TELEGRAM_CHAT_ID
 *    (same values as your GitHub Actions secrets -- these stay inside
 *    your own Google account, never in the git repo or the website.)
 * 4. Triggers (clock icon, left sidebar) -> + Add Trigger, set:
 *      Choose which function to run: onLeadApproved
 *      Select event source: From spreadsheet
 *      Select event type: On edit
 *    Save, then approve the Google authorization prompt -- this is
 *    what lets the script call Slack/Telegram; it only runs inside
 *    your own Google account.
 * 5. Tick an "Approve" checkbox in the Leads tab to test it, then
 *    check the Executions log (left sidebar) if nothing arrives.
 *
 * OPTIONAL -- "Send notifications now" button on the dashboard:
 *
 * 6. Script Properties -> add one more property, WEB_APP_SECRET,
 *    set to any long random string you make up yourself (this is
 *    NOT a Slack/Telegram/GitHub credential -- it's just a shared
 *    password between this script and your website, so a stranger
 *    can't call the URL from step 7 and trigger a send).
 * 7. Deploy (top-right) -> New deployment -> gear icon -> Web app.
 *      Execute as: Me
 *      Who has access: Anyone
 *    Deploy, authorize again if asked, then copy the Web app URL.
 * 8. Put that URL and the same WEB_APP_SECRET value into the
 *    website's config.js (NOTIFY_WEBHOOK_URL / NOTIFY_WEBHOOK_SECRET).
 *    The "Send notifications now" button on the Leads page then
 *    calls this URL directly.
 *
 * OPTIONAL -- "Email assignees" button (lead assignment):
 *
 * 9. Add an "Assigned To" header at the end of row 1 on the Leads
 *    tab. The dashboard's Leads page then lets the Owner/approvers
 *    assign leads to teammates.
 * 10. The "Email assignees" button calls this same Web App with
 *    action=notifyAssignee and sends a plain email from YOUR Google
 *    account. It only emails the Owner or someone on the Team tab,
 *    and only about leads currently assigned to that person.
 *    To authorise sending mail: in the editor choose the function
 *    authorizeMail_ and click Run (approve the prompt), then
 *    Deploy -> Manage deployments -> pencil icon -> Version: New
 *    version -> Deploy. (The URL stays the same.)
 *    Optional Script Property DASHBOARD_URL adds a link to the email.
 *
 * Other than that, this script only ever reads/writes the Leads
 * sheet's Approve / Slack Notified / Telegram Notified columns --
 * it never touches discovery or qualification. Email assignment only
 * READS the Leads and Team tabs.
 */

var LEADS_TAB_NAME = "Leads";
var TRUE_VALUES = ["true", "yes", "1", "✓"]; // includes checkmark "✓"

function isTrue_(value) {
  return TRUE_VALUES.indexOf(String(value).trim().toLowerCase()) !== -1;
}

function onLeadApproved(e) {
  if (!e || !e.range) return;

  var sheet = e.range.getSheet();
  if (sheet.getName() !== LEADS_TAB_NAME) return;

  // Ignore edits to the header row.
  var editedRow = e.range.getRow();
  if (editedRow < 2) return;

  var headerRow = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0];

  var headers = {};
  for (var i = 0; i < headerRow.length; i++) {
    headers[String(headerRow[i]).trim()] = i + 1; // 1-based column number
  }

  var required = ["Approve", "Slack Notified", "Telegram Notified"];
  for (var r = 0; r < required.length; r++) {
    if (!headers[required[r]]) {
      Logger.log("Missing required Leads column: " + required[r]);
      return;
    }
  }

  var approveCol = headers["Approve"];
  var slackCol = headers["Slack Notified"];
  var telegramCol = headers["Telegram Notified"];

  // Only react when the edit touched the Approve column itself --
  // editing some other cell on an already-approved row should not
  // re-trigger a send.
  var editedCol = e.range.getColumn();
  if (editedCol !== approveCol) return;

  var approveValue = sheet.getRange(editedRow, approveCol).getValue();
  if (!isTrue_(approveValue)) return;

  var slackSent = isTrue_(
    sheet.getRange(editedRow, slackCol).getValue()
  );
  var telegramSent = isTrue_(
    sheet.getRange(editedRow, telegramCol).getValue()
  );

  if (slackSent && telegramSent) return; // nothing left to do

  var rowValues = sheet
    .getRange(editedRow, 1, 1, sheet.getLastColumn())
    .getValues()[0];

  var lead = {};
  for (var key in headers) {
    lead[key] = rowValues[headers[key] - 1];
  }

  if (!slackSent) {
    if (sendSlack_(lead)) {
      sheet.getRange(editedRow, slackCol).setValue("TRUE");
    }
  }

  if (!telegramSent) {
    if (sendTelegram_(lead)) {
      sheet.getRange(editedRow, telegramCol).setValue("TRUE");
    }
  }
}

/**
 * Web app entry point for the dashboard's "Send notifications now"
 * button. Scans the whole Leads sheet for already-approved leads
 * that are still missing a notification -- same full-sheet logic as
 * notifier.py's poll, just run on demand instead of every 5 minutes.
 */
function doGet(e) {
  var props = PropertiesService.getScriptProperties();
  var expectedSecret = props.getProperty("WEB_APP_SECRET");

  if (expectedSecret && (!e || e.parameter.secret !== expectedSecret)) {
    return ContentService
      .createTextOutput(
        JSON.stringify({ ok: false, error: "Invalid or missing secret." })
      )
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (e && e.parameter && e.parameter.action === "notifyAssignee") {
    return jsonOut_(emailAssignee_(e.parameter));
  }

  if (e && e.parameter && e.parameter.action === "sendCycle") {
    return jsonOut_(sendCycle_(e.parameter));
  }

  var result = sendPendingNotifications();

  return ContentService
    .createTextOutput(
      JSON.stringify({
        ok: true,
        sent: result.sent,
        retried: result.retried,
      })
    )
    .setMimeType(ContentService.MimeType.JSON);
}

function sendPendingNotifications() {
  var sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(LEADS_TAB_NAME);

  var headerRow = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0];

  var headers = {};
  for (var i = 0; i < headerRow.length; i++) {
    headers[String(headerRow[i]).trim()] = i + 1;
  }

  var required = ["Approve", "Slack Notified", "Telegram Notified"];
  for (var r = 0; r < required.length; r++) {
    if (!headers[required[r]]) {
      Logger.log("Missing required Leads column: " + required[r]);
      return { sent: 0, retried: 0 };
    }
  }

  var approveCol = headers["Approve"];
  var slackCol = headers["Slack Notified"];
  var telegramCol = headers["Telegram Notified"];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { sent: 0, retried: 0 };
  }

  var allValues = sheet
    .getRange(2, 1, lastRow - 1, sheet.getLastColumn())
    .getValues();

  var sent = 0;
  var retried = 0;

  for (var rowOffset = 0; rowOffset < allValues.length; rowOffset++) {
    var rowValues = allValues[rowOffset];
    var rowNumber = rowOffset + 2;

    var approveValue = rowValues[approveCol - 1];
    if (!isTrue_(approveValue)) continue;

    var slackSent = isTrue_(rowValues[slackCol - 1]);
    var telegramSent = isTrue_(rowValues[telegramCol - 1]);

    if (slackSent && telegramSent) continue;

    var lead = {};
    for (var key in headers) {
      lead[key] = rowValues[headers[key] - 1];
    }

    if (!slackSent) {
      if (sendSlack_(lead)) {
        sheet.getRange(rowNumber, slackCol).setValue("TRUE");
        sent++;
      } else {
        retried++;
      }
    }

    if (!telegramSent) {
      if (sendTelegram_(lead)) {
        sheet.getRange(rowNumber, telegramCol).setValue("TRUE");
        sent++;
      } else {
        retried++;
      }
    }
  }

  return { sent: sent, retried: retried };
}

function formatMessage_(lead) {
  return (
    "New qualified lead: " + (lead["Business Name"] || "—") + "\n" +
    "Industry: " + (lead["Industry"] || "—") +
    " | Location: " + (lead["Location"] || "—") + "\n" +
    "Phone: " + (lead["Phone"] || "—") +
    " | Source: " + (lead["Lead Source"] || "—") + "\n" +
    "Score: " + (lead["Score"] || "—") +
    " | Priority: " + (lead["Priority"] || "—")
  );
}

function sendSlack_(lead) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("SLACK_BOT_TOKEN");
  var channel = props.getProperty("SLACK_CHANNEL_ID");

  if (!token || !channel) {
    Logger.log("Slack configuration missing in Script Properties.");
    return false;
  }

  try {
    var response = UrlFetchApp.fetch(
      "https://slack.com/api/chat.postMessage",
      {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + token },
        payload: JSON.stringify({
          channel: channel,
          text: formatMessage_(lead),
        }),
        muteHttpExceptions: true,
      }
    );

    var data = JSON.parse(response.getContentText());

    if (!data.ok) {
      Logger.log("Slack send failed: " + response.getContentText());
    }

    return data.ok === true;
  } catch (exc) {
    Logger.log("Slack send error: " + exc);
    return false;
  }
}

function sendTelegram_(lead) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("TELEGRAM_BOT_TOKEN");
  var chatId = props.getProperty("TELEGRAM_CHAT_ID");

  if (!token || !chatId) {
    Logger.log("Telegram configuration missing in Script Properties.");
    return false;
  }

  try {
    var response = UrlFetchApp.fetch(
      "https://api.telegram.org/bot" + token + "/sendMessage",
      {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({
          chat_id: chatId,
          text: formatMessage_(lead),
        }),
        muteHttpExceptions: true,
      }
    );

    var data = JSON.parse(response.getContentText());

    if (!data.ok) {
      Logger.log("Telegram send failed: " + response.getContentText());
    }

    return data.ok === true;
  } catch (exc) {
    Logger.log("Telegram send error: " + exc);
    return false;
  }
}

// ----------------------------------------------------------------
// Lead assignment emails
// ----------------------------------------------------------------

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Run this once from the editor so Google asks you to allow sending
// email, then redeploy the web app as a new version.
function authorizeMail_() {
  Logger.log("Mail quota left today: " + MailApp.getRemainingDailyQuota());
}

function escapeHtml_(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Only the sheet's owner or someone listed on the Team tab may be emailed.
function isKnownTeammate_(spreadsheet, email) {
  try {
    var owner = spreadsheet.getOwner();
    if (owner && owner.getEmail().toLowerCase() === email) return true;
  } catch (err) {
    // Shared-drive sheets have no single owner; fall through to Team tab.
  }

  var team = spreadsheet.getSheetByName("Team");
  if (!team || team.getLastRow() < 2) return false;

  var values = team.getDataRange().getValues();
  var emailCol = -1;
  for (var c = 0; c < values[0].length; c++) {
    if (String(values[0][c]).trim().toLowerCase() === "email") emailCol = c;
  }
  if (emailCol === -1) return false;

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][emailCol]).trim().toLowerCase() === email) return true;
  }
  return false;
}

function emailAssignee_(params) {
  var assignee = String(params.assignee || "").trim().toLowerCase();
  var ids = String(params.leadIds || "")
    .split(",")
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s; });
  var sentBy = String(params.sentBy || "").trim();

  if (!assignee || ids.length === 0) {
    return { ok: false, error: "Missing assignee or leads." };
  }
  if (ids.length > 50) {
    return { ok: false, error: "Too many leads in one email (max 50)." };
  }

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  if (!isKnownTeammate_(spreadsheet, assignee)) {
    return { ok: false, error: assignee + " is not the owner or on the Team tab." };
  }

  var sheet = spreadsheet.getSheetByName(LEADS_TAB_NAME);
  if (!sheet || sheet.getLastRow() < 2) {
    return { ok: false, error: "No leads found." };
  }

  var values = sheet.getDataRange().getValues();
  var headers = {};
  for (var i = 0; i < values[0].length; i++) {
    headers[String(values[0][i]).trim()] = i;
  }

  if (headers["Lead ID"] === undefined || headers["Assigned To"] === undefined) {
    return { ok: false, error: 'The Leads tab needs "Lead ID" and "Assigned To" headers.' };
  }

  var wanted = {};
  ids.forEach(function (id) { wanted[id] = true; });

  var leads = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var id = String(row[headers["Lead ID"]]).trim();

    if (!wanted[id]) continue;
    if (String(row[headers["Assigned To"]]).trim().toLowerCase() !== assignee) continue;

    var lead = {};
    for (var key in headers) lead[key] = row[headers[key]];
    leads.push(lead);
  }

  if (leads.length === 0) {
    return { ok: false, error: "None of those leads are currently assigned to " + assignee + "." };
  }

  var dashboardUrl = PropertiesService.getScriptProperties().getProperty("DASHBOARD_URL") || "";
  var plain = [];
  var html = [];

  leads.forEach(function (lead) {
    var lines = [
      ["Industry", lead["Industry"]],
      ["Location", lead["Location"]],
      ["Phone", lead["Phone"]],
      ["Instagram", lead["Instagram ID"]],
      ["Score / Priority", (lead["Score"] || "—") + " / " + (lead["Priority"] || "—")],
      ["Opportunity", lead["Opportunity"]],
    ];

    plain.push(
      (lead["Business Name"] || "—") + " (" + lead["Lead ID"] + ")\n" +
      lines.map(function (l) { return "  " + l[0] + ": " + (l[1] || "—"); }).join("\n")
    );

    html.push(
      "<p><strong>" + escapeHtml_(lead["Business Name"] || "—") + "</strong> (" +
      escapeHtml_(lead["Lead ID"]) + ")<br>" +
      lines.map(function (l) { return escapeHtml_(l[0]) + ": " + escapeHtml_(l[1] || "—"); }).join("<br>") +
      "</p>"
    );
  });

  var intro =
    leads.length + (leads.length === 1 ? " lead has" : " leads have") +
    " been assigned to you" + (sentBy ? " (sent by " + sentBy + ")" : "") + ".";

  MailApp.sendEmail({
    to: assignee,
    subject: leads.length + (leads.length === 1 ? " lead" : " leads") + " assigned to you — Official Creations",
    body: intro + "\n\n" + plain.join("\n\n") + (dashboardUrl ? "\n\nDashboard: " + dashboardUrl : ""),
    htmlBody:
      "<p>" + escapeHtml_(intro) + "</p>" + html.join("") +
      (dashboardUrl ? '<p><a href="' + escapeHtml_(dashboardUrl) + '">Open the dashboard</a></p>' : ""),
    name: "Official Creations Lead Automation",
  });

  return { ok: true, emailed: leads.length, to: assignee };
}


// ----------------------------------------------------------------
// Lead cycles: one Slack + one Telegram message per cycle
//
// Called by the dashboard (action=sendCycle&cycleId=C001).
//   - Without force=1 it is the automatic "cycle is full" send: it only
//     goes out when the cycle holds at least its Limit of leads AND that
//     many leads have not already been sent (Sent Count). So two people
//     filling a cycle at the same moment cannot send it twice.
//   - With force=1 it is the manual "Send now" and always sends.
//
// Cycles tab headers: Cycle ID | Name | Number | Niche | Limit |
//   Created By | Created At | Sent At | Sent Count
// Leads tab needs a "Cycle" column holding the Cycle ID.
// ----------------------------------------------------------------

var CYCLES_TAB_NAME = "Cycles";
var CYCLE_CHUNK_CHARS_ = 3500; // Telegram allows 4096 per message

function headerMap_(headers) {
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var k = String(headers[i]).trim().toLowerCase();
    if (k && map[k] === undefined) map[k] = i;
  }
  return map;
}

function sendCycle_(params) {
  var cycleId = String(params.cycleId || "").trim();
  var force = String(params.force || "") === "1";

  if (!cycleId) return { ok: false, error: "Missing cycleId." };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return { ok: false, error: "Another send is in progress. Try again in a moment." };
  }

  try {
    return sendCycleLocked_(cycleId, force);
  } catch (exc) {
    Logger.log("sendCycle error: " + exc);
    return { ok: false, error: "Cycle send failed: " + exc };
  } finally {
    lock.releaseLock();
  }
}

function sendCycleLocked_(cycleId, force) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var cyclesSheet = spreadsheet.getSheetByName(CYCLES_TAB_NAME);
  var leadsSheet = spreadsheet.getSheetByName(LEADS_TAB_NAME);

  if (!cyclesSheet) return { ok: false, error: 'No "' + CYCLES_TAB_NAME + '" tab found.' };
  if (!leadsSheet) return { ok: false, error: 'No "' + LEADS_TAB_NAME + '" tab found.' };

  var cv = cyclesSheet.getDataRange().getValues();
  var lv = leadsSheet.getDataRange().getValues();
  if (cv.length < 2) return { ok: false, error: "The Cycles tab has no cycles." };

  var ch = headerMap_(cv[0]);
  var lh = headerMap_(lv[0] || []);

  if (ch["cycle id"] === undefined) return { ok: false, error: 'Cycles tab needs a "Cycle ID" header.' };
  if (lh["cycle"] === undefined) return { ok: false, error: 'Leads tab needs a "Cycle" header.' };

  var cycleRow = -1;
  for (var i = 1; i < cv.length; i++) {
    if (String(cv[i][ch["cycle id"]]).trim().toLowerCase() === cycleId.toLowerCase()) {
      cycleRow = i;
      break;
    }
  }
  if (cycleRow === -1) return { ok: false, error: "Cycle " + cycleId + " was not found." };

  var cget = function (name) {
    var idx = ch[name];
    return idx === undefined ? "" : cv[cycleRow][idx];
  };
  var name = String(cget("name") || cycleId);
  var number = String(cget("number"));
  var niche = String(cget("niche"));
  var limit = Number(cget("limit")) || 0;

  var leads = [];
  for (var r = 1; r < lv.length; r++) {
    var row = lv[r];
    var inCycle = String(row[lh["cycle"]]).trim().toLowerCase() === cycleId.toLowerCase();
    var hasId =
      (lh["lead id"] !== undefined && String(row[lh["lead id"]]).trim() !== "") ||
      (lh["business name"] !== undefined && String(row[lh["business name"]]).trim() !== "");
    if (inCycle && hasId) leads.push(row);
  }

  if (leads.length === 0) return { ok: false, error: "This cycle has no leads yet." };

  if (!force) {
    var sentCount = ch["sent count"] !== undefined ? Number(cget("sent count")) || 0 : null;
    var alreadySent =
      sentCount !== null ? sentCount >= limit : String(cget("sent at")).trim() !== "";

    if (!limit || leads.length < limit) {
      return { ok: true, skipped: true, reason: "Cycle is not full yet." };
    }
    if (alreadySent) {
      return { ok: true, skipped: true, reason: "Cycle was already sent at this size." };
    }
  }

  var lget = function (row, col) {
    var idx = lh[col];
    return idx === undefined ? "" : String(row[idx]).trim();
  };

  var title = "Lead cycle: " + name + (number ? " (No. " + number + ")" : "");
  var head =
    title + "\n" +
    "Niche: " + (niche || "—") + "\n" +
    "Leads: " + leads.length + (limit ? " of " + limit : "") + "\n";

  var lines = leads.map(function (row, i) {
    var contact = lget(row, "phone") || lget(row, "instagram id") || "—";
    var parts = [
      (i + 1) + ". " + (lget(row, "business name") || "—"),
      lget(row, "location") || "—",
      contact,
    ];
    var pr = lget(row, "priority");
    var sc = lget(row, "score");
    if (pr || sc) parts.push((pr || "—") + (sc ? " (" + sc + ")" : ""));
    var as = lget(row, "assigned to");
    if (as) parts.push(as);
    return parts.join(" | ");
  });

  var chunks = [];
  var current = head;
  for (var n = 0; n < lines.length; n++) {
    if (current.length + lines[n].length + 1 > CYCLE_CHUNK_CHARS_ && current.length > 0) {
      chunks.push(current);
      current = title + " (continued)\n";
    }
    current += lines[n].substring(0, 600) + "\n";
  }
  chunks.push(current);

  var slackOk = true;
  var telegramOk = true;
  chunks.forEach(function (text) {
    if (!postSlackText_(text)) slackOk = false;
    if (!postTelegramText_(text)) telegramOk = false;
  });

  if (!slackOk && !telegramOk) {
    return {
      ok: false,
      error: "Neither Slack nor Telegram accepted the message. Check the Script Properties and the Executions log.",
    };
  }

  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
  if (ch["sent at"] !== undefined) cyclesSheet.getRange(cycleRow + 1, ch["sent at"] + 1).setValue(stamp);
  if (ch["sent count"] !== undefined) cyclesSheet.getRange(cycleRow + 1, ch["sent count"] + 1).setValue(leads.length);

  return {
    ok: true,
    sent: leads.length,
    slack: slackOk,
    telegram: telegramOk,
    messages: chunks.length,
    sentAt: stamp,
  };
}

function postSlackText_(text) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("SLACK_BOT_TOKEN");
  var channel = props.getProperty("SLACK_CHANNEL_ID");

  if (!token || !channel) {
    Logger.log("Slack configuration missing in Script Properties.");
    return false;
  }

  try {
    var response = UrlFetchApp.fetch("https://slack.com/api/chat.postMessage", {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify({ channel: channel, text: text }),
      muteHttpExceptions: true,
    });
    var data = JSON.parse(response.getContentText());
    if (!data.ok) Logger.log("Slack send failed: " + response.getContentText());
    return data.ok === true;
  } catch (exc) {
    Logger.log("Slack send error: " + exc);
    return false;
  }
}

function postTelegramText_(text) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("TELEGRAM_BOT_TOKEN");
  var chatId = props.getProperty("TELEGRAM_CHAT_ID");

  if (!token || !chatId) {
    Logger.log("Telegram configuration missing in Script Properties.");
    return false;
  }

  try {
    var response = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ chat_id: chatId, text: text }),
      muteHttpExceptions: true,
    });
    var data = JSON.parse(response.getContentText());
    if (!data.ok) Logger.log("Telegram send failed: " + response.getContentText());
    return data.ok === true;
  } catch (exc) {
    Logger.log("Telegram send error: " + exc);
    return false;
  }
}
