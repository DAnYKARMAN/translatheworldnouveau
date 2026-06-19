// netlify/functions/stripe-webhook.js
// ─────────────────────────────────────────────────────────────────────
// Reçoit l'événement Stripe `checkout.session.completed` après paiement.
//   1) Active la quota Firebase dans subscriptions/{room}
//      → indispensable pour que la session live limite le temps utilisé
//   2) Stocke une trace d'audit dans sessions/{room}/purchase
//   3) Envoie l'email bilingue (template_udijx31) avec hôte + QR code
// ─────────────────────────────────────────────────────────────────────

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin  = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY||'').replace(/\\n/g,'\n'),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

// Nom natif des langues (pour l'email envoyé au client)
const LANG_NAMES = {
  fr:'Français',  en:'English',     de:'Deutsch',     it:'Italiano',
  es:'Español',   pt:'Português',   ar:'العربية',     ru:'Русский',
  zh:'中文',       he:'עברית',       nl:'Nederlands',  pl:'Polski',
  uk:'Українська',tr:'Türkçe',      ja:'日本語',       ko:'한국어',
  hi:'हिन्दी',     el:'Ελληνικά',    da:'Dansk',
};

// Validité de la session après achat : 30 jours pour toute durée
const VALIDITY_DAYS = 30;

exports.handler = async function(event) {
  // ── 1) Vérification de la signature Stripe (anti-falsification) ──
  const sig = event.headers['stripe-signature'];
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body, sig, process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch(err) {
    console.error('Webhook signature error:', err.message);
    return { statusCode:400, body:'Signature invalide: '+err.message };
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    // Tout autre événement Stripe est ignoré (mais on répond 200 pour
    // que Stripe ne retente pas)
    return { statusCode:200, body:JSON.stringify({received:true, ignored:stripeEvent.type}) };
  }

  const session = stripeEvent.data.object;
  const meta    = session.metadata || {};

  // ── Paramètres lus depuis les metadata Stripe ─────────────────────
  const room          = meta.room || ('room_'+Date.now());
  const langSrc       = meta.langSrc || 'fr';
  const targets       = meta.targets || '';
  const hours         = parseInt(meta.hours      || '1', 10);
  const extraLangs    = parseInt(meta.extraLangs || '0', 10);
  const customerName  = meta.customerName  || session.customer_details?.name || '';
  const customerEmail = meta.customerEmail || session.customer_email || '';
  const organisation  = meta.organisation  || '';

  const minutesAllowed = hours * 60;
  const expTs   = Math.floor(Date.now()/1000) + VALIDITY_DAYS * 24 * 3600;
  const expDate = new Date(expTs*1000).toLocaleDateString('fr-FR', {
    day:'numeric', month:'long', year:'numeric'
  });

  // ── Liens hôte et participants ────────────────────────────────────
  const baseUrl         = 'https://translatetheworld.com';
  const hostLink        = baseUrl + '/host-setup.html'
    + '?room=' + encodeURIComponent(room)
    + '&lang=' + langSrc
    + '&to='   + encodeURIComponent(targets)
    + '&dur='  + minutesAllowed
    + '&exp='  + expTs;
  const participantLink = baseUrl + '/join.html'
    + '?room=' + encodeURIComponent(room)
    + '&exp='  + expTs;
  const qrUrl = 'https://quickchart.io/qr?size=300&text=' + encodeURIComponent(participantLink);

  // ── 2) CRITIQUE : Activation de la quota Firebase ─────────────────
  //    La page de session live (host-session.html) lit minutesAllowed
  //    et minutesUsed depuis subscriptions/{room}. Sans cette écriture,
  //    aucune limite n'est appliquée au client payant.
  try {
    await admin.database().ref('subscriptions/'+room).set({
      plan:           hours + 'H',
      hours,
      extraLangs,
      minutesAllowed,
      minutesUsed:    0,
      active:         true,
      activatedAt:    Date.now(),
      expTs,
      customerEmail,
      customerName,
      organisation,
      stripeSessionId: session.id,
    });
    console.log('[subscriptions] activated room=%s minutes=%s', room, minutesAllowed);
  } catch(e){ console.error('Firebase subscriptions error:', e); }

  // ── 3) Trace d'audit (séparée pour conservation indépendante) ─────
  try {
    await admin.database().ref('sessions/'+room+'/purchase').set({
      hours, extraLangs, langSrc, targets,
      customerName, customerEmail, organisation,
      expTs, paidAt: Date.now(),
      stripeSessionId: session.id,
      hostLink, participantLink,
    });
  } catch(e){ console.error('Firebase sessions error:', e); }

  // ── 4) Email bilingue avec liens et QR code ───────────────────────
  const tArr = targets.split(',').filter(Boolean);
  try {
    await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id:  'service_98a5sho',
        template_id: 'template_udijx31',
        user_id:     'nkdEOMlq3ycO1AsIc',
        template_params: {
          to_email:         customerEmail,
          to_name:          customerName,
          organisation:     organisation || '—',
          host_link:        hostLink,
          participant_link: participantLink,
          qr_url:           qrUrl,
          lang_src:         LANG_NAMES[langSrc] || langSrc,
          lang_p1:          LANG_NAMES[tArr[0]] || tArr[0] || '—',
          lang_p2:          LANG_NAMES[tArr[1]] || tArr[1] || '—',
          lang_p3:          LANG_NAMES[tArr[2]] || tArr[2] || '—',
          duration:         hours + 'h (' + minutesAllowed + ' min)',
          exp_date:         expDate,
        }
      })
    });
    console.log('[email] sent to %s for room=%s', customerEmail, room);
  } catch(e){ console.error('EmailJS error:', e); }

  return { statusCode:200, body:JSON.stringify({received:true}) };
};
