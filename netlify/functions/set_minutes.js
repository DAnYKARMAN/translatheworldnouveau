// netlify/functions/set-minutes.js
// Outil de test/admin : écrit directement dans Firebase
// Usage : POST avec { room, minutes, plan }

const admin = require('firebase-admin');

if (!admin.apps.length) {
  try {
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    console.log('FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID);
    console.log('FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL ? 'présent' : 'MANQUANT');
    console.log('FIREBASE_PRIVATE_KEY début:', privateKey.substring(0, 40));
    console.log('FIREBASE_DATABASE_URL:', process.env.FIREBASE_DATABASE_URL);

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  privateKey,
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    console.log('Firebase Admin initialisé ✅');
  } catch(e) {
    console.error('Erreur init Firebase:', e.message);
  }
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode:405, body:'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode:400, body:JSON.stringify({error:'Invalid JSON'}) }; }

  const { room, minutes, plan } = body;
  if (!room || !minutes) return { statusCode:400, body:JSON.stringify({error:'room et minutes requis'}) };

  try {
    const db = admin.database();
    const ref = db.ref('subscriptions/' + room);
    const snap = await ref.once('value');
    const existing = snap.val();
    console.log('Données existantes:', JSON.stringify(existing));

    await ref.update({
      plan:           plan || '2H',
      minutesAllowed: parseInt(minutes),
      minutesUsed:    0,
      active:         true,
      activatedAt:    Date.now(),
    });

    console.log('✅ Mise à jour réussie — room:', room, 'minutes:', minutes);
    return { statusCode:200, body:JSON.stringify({ok:true, room, minutes}) };

  } catch(err) {
    console.error('Erreur Firebase:', err.message);
    return { statusCode:500, body:JSON.stringify({error:err.message}) };
  }
};
