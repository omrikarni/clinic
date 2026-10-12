/**
 * הקליניקה שלי — שליחת תזכורות אוטומטית
 * ----------------------------------------
 * הסקריפט רץ בחשבון הגוגל שלך (script.google.com) כל 15 דקות, גם כשהאפליקציה סגורה.
 * הוא קורא את "תיבת הדואר היוצא" שהאפליקציה כותבת לדרייב שלך, ושולח את התזכורות שהגיע זמנן:
 *   • מייל — מחשבון ה-Gmail שלך (GmailApp).
 *   • ווטסאפ — דרך WhatsApp Business Cloud API, אחרי שמגדירים אותו (ראי מדריך ההקמה, שלב 5ב).
 * הסקריפט לא ניגש למידע המוצפן של האפליקציה — רק לשני הקבצים בתיקייה "הקליניקה — תזכורות".
 *
 * הפעלה: מדביקים את הקובץ כולו בפרויקט Apps Script חדש, בוחרים בפונקציה setup ולוחצים Run.
 */

const OUTBOX_NAME = 'clinic-reminders-outbox.json';
const STATUS_NAME = 'clinic-reminders-status.json';
const MAX_ATTEMPTS = 3;

/** להריץ פעם אחת: יוצר הפעלה אוטומטית כל 15 דקות ומריץ סבב ראשון. */
function setup() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'run')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('run').timeBased().everyMinutes(15).create();
  run();
  Logger.log('ההפעלה האוטומטית הוגדרה. הסקריפט ירוץ כל 15 דקות.');
}

/** בדיקה ידנית: שולח מייל ניסיון לעצמך. */
function testEmail() {
  const me = Session.getActiveUser().getEmail();
  GmailApp.sendEmail(me, 'בדיקת תזכורות — הקליניקה שלי', 'אם המייל הזה הגיע, שליחת המיילים האוטומטית עובדת.');
  Logger.log('נשלח מייל בדיקה אל ' + me);
}

function findFile_(name) {
  const it = DriveApp.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}

function run() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const outFile = findFile_(OUTBOX_NAME), statusFile = findFile_(STATUS_NAME);
    if (!outFile || !statusFile) { Logger.log('קובצי התזכורות עוד לא נוצרו — יש לפתוח את האפליקציה פעם אחת אחרי הפעלת השליחה האוטומטית.'); return; }
    const outbox = JSON.parse(outFile.getBlob().getDataAsString('UTF-8') || '{"items":[]}');
    const status = JSON.parse(statusFile.getBlob().getDataAsString('UTF-8') || '{}');
    const props = PropertiesService.getScriptProperties();
    const now = Date.now(), stamp = new Date().toISOString();
    let sent = 0, failed = 0;

    (outbox.items || []).forEach(function (it) {
      const st = status[it.id] || {};
      if (st.status === 'sent') return;
      if ((st.attempts || 0) >= MAX_ATTEMPTS) return;
      const due = Date.parse(it.sendAt), apptAt = Date.parse(it.apptAt);
      if (isNaN(due) || now < due) return;          // עוד לא הגיע הזמן
      if (now > apptAt) return;                     // הפגישה כבר התחילה — לא שולחים באיחור

      try {
        if (it.channel === 'email') {
          GmailApp.sendEmail(it.to, it.subject, it.body, { name: outbox.senderName || '' });
          status[it.id] = { status: 'sent', at: stamp };
          sent++;
        } else if (it.channel === 'whatsapp') {
          const token = props.getProperty('WA_TOKEN'), phoneId = props.getProperty('WA_PHONE_NUMBER_ID'), tpl = props.getProperty('WA_TEMPLATE_NAME');
          if (!token || !phoneId || !tpl) { status[it.id] = { status: 'waiting', at: stamp, error: 'ווטסאפ עוד לא חובר לשליחה אוטומטית' }; return; }
          const version = props.getProperty('WA_API_VERSION') || 'v21.0';
          const lang = props.getProperty('WA_TEMPLATE_LANG') || 'he';
          const nParams = Number(props.getProperty('WA_TEMPLATE_PARAMS') || (it.waParams || []).length);
          const params = (it.waParams || []).slice(0, nParams).map(function (t) { return { type: 'text', text: String(t || '-') }; });
          const res = UrlFetchApp.fetch('https://graph.facebook.com/' + version + '/' + phoneId + '/messages', {
            method: 'post', contentType: 'application/json', muteHttpExceptions: true,
            headers: { Authorization: 'Bearer ' + token },
            payload: JSON.stringify({ messaging_product: 'whatsapp', to: it.to, type: 'template',
              template: { name: tpl, language: { code: lang }, components: params.length ? [{ type: 'body', parameters: params }] : [] } })
          });
          if (res.getResponseCode() < 300) { status[it.id] = { status: 'sent', at: stamp }; sent++; }
          else throw new Error('WhatsApp ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 180));
        }
      } catch (e) {
        status[it.id] = { status: 'failed', at: stamp, error: String(e.message || e).slice(0, 200), attempts: (st.attempts || 0) + 1 };
        failed++;
      }
    });

    // ניקוי רשומות ישנות (מעל 45 יום)
    const cutoff = now - 45 * 86400000;
    Object.keys(status).forEach(function (k) { if (k !== '_meta' && Date.parse(status[k].at) < cutoff) delete status[k]; });
    status._meta = { lastRun: stamp, lastSent: sent, lastFailed: failed };
    statusFile.setContent(JSON.stringify(status));
  } finally {
    lock.releaseLock();
  }
}
