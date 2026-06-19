// netlify/functions/create-checkout.js
// ─────────────────────────────────────────────────────────────────────
// Modèle tarifaire LINÉAIRE
//   Base 1h × 2 langues (1 source + 1 cible) = 59,99 € TTC
//   + 49,99 € TTC par heure supplémentaire
//   + 49,99 € TTC par langue cible supplémentaire et par heure
// Plage : 1–12 heures · 0–2 langues cibles supplémentaires
// Sécurité : le MONTANT est recalculé côté serveur à partir de `hours`
//            et du nombre de cibles. Le total reçu du client n'est jamais
//            utilisé (parade à la falsification depuis le navigateur).
// ─────────────────────────────────────────────────────────────────────

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const BASE_TTC       = 5999;  // 1h, 2 langues (centimes)
const EXTRA_H_TTC    = 4999;  // par heure supplémentaire
const EXTRA_LANG_TTC = 4999;  // par langue cible supplémentaire × heure
const MIN_HOURS      = 1;
const MAX_HOURS      = 12;
const MAX_EXTRA      = 2;     // donc max 3 cibles, 4 langues totales

function computeAmountCents(hours, extraLangs){
  return BASE_TTC
       + (hours - 1) * EXTRA_H_TTC
       + extraLangs * hours * EXTRA_LANG_TTC;
}

function planLabel(hours, extraLangs, isFr){
  const total = 2 + extraLangs;
  return hours + 'h · ' + total + (isFr ? ' langues' : ' languages');
}

exports.handler = async function(event){
  if(event.httpMethod !== 'POST'){
    return { statusCode:405, body:'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e){ return { statusCode:400, body:JSON.stringify({error:'Invalid JSON'}) }; }

  const {
    room,
    customerEmail, customerName, organisation,
    langSrc, targets, languages,
    hours: hoursRaw,
    locale
  } = body;

  // ── Validation `hours` ─────────────────────────────────────────────
  const hours = parseInt(hoursRaw, 10);
  if(!Number.isFinite(hours) || hours < MIN_HOURS || hours > MAX_HOURS){
    return {
      statusCode:400,
      body:JSON.stringify({error:'Number of hours must be between '+MIN_HOURS+' and '+MAX_HOURS})
    };
  }

  // ── Validation cibles ──────────────────────────────────────────────
  const tArr = (targets || '').split(',').map(s=>s.trim()).filter(Boolean);
  if(tArr.length < 1){
    return { statusCode:400, body:JSON.stringify({error:'At least 1 target language required'}) };
  }
  if(tArr.length > (1 + MAX_EXTRA)){
    return { statusCode:400, body:JSON.stringify({error:'Too many target languages'}) };
  }
  const extraLangs = tArr.length - 1; // 1ère cible incluse, le reste = supplémentaire

  // ── Calcul du montant CÔTÉ SERVEUR (sécurité) ──────────────────────
  const amountCents = computeAmountCents(hours, extraLangs);
  const isFr = (locale === 'fr');

  const planText  = planLabel(hours, extraLangs, isFr);
  const langList  = (languages || (langSrc+','+targets)).split(',').filter(Boolean);
  const description = planText
    + (isFr ? ' · Langues : ' : ' · Languages: ') + langList.map(l => l.toUpperCase()).join(', ')
    + (isFr ? ' · Salle : '  : ' · Room: ')       + (room || '—');

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customerEmail || undefined,
      line_items: [{
        price_data: {
          currency: 'eur',
          tax_behavior: 'inclusive',
          product_data: {
            name: 'TranslateTheWorld — ' + planText,
            description,
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      metadata: {
        room:          room || '',
        customerName:  customerName || '',
        organisation:  organisation || '',
        langSrc:       langSrc || 'fr',
        targets:       targets || '',
        languages:     languages || '',
        hours:         String(hours),
        extraLangs:    String(extraLangs),
      },
      success_url: 'https://translatetheworld.com/merci/?session_id={CHECKOUT_SESSION_ID}&hours='+hours+'&extra='+extraLangs,
      cancel_url:  'https://translatetheworld.com/#pricing',
    });

    return { statusCode:200, body:JSON.stringify({ url:session.url }) };
  } catch(err){
    console.error('Stripe error:', err);
    return { statusCode:500, body:JSON.stringify({ error:err.message }) };
  }
};
