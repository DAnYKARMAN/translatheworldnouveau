// ─────────────────────────────────────────────────────────────
//  Netlify Function : send-free-trial-email
//
//  Rôle : recevoir les infos du formulaire d'essai gratuit depuis
//  le navigateur, puis appeler EmailJS DEPUIS LE SERVEUR
//  (pas depuis le navigateur du client).
//
//  Avantage : depuis un serveur, il n'y a jamais de blocage 4G,
//  jamais de CORS, jamais d'ITP Safari. C'est 100% fiable.
//
//  Cette fonction est appelée automatiquement quand le navigateur
//  du client fait un POST vers :
//    /.netlify/functions/send-free-trial-email
// ─────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  // On n'accepte que les requêtes POST (par sécurité)
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Lecture des données envoyées par le navigateur
    const params = JSON.parse(event.body || '{}');

    // Récupération des identifiants EmailJS depuis les variables Netlify
    const serviceId  = process.env.EMAILJS_SERVICE_ID;
    const templateId = process.env.EMAILJS_TEMPLATE_ID;
    const publicKey  = process.env.EMAILJS_PUBLIC_KEY;
    const privateKey = process.env.EMAILJS_KEY; // clé privée (accessToken)

    // Vérification que les variables sont bien configurées
    if (!serviceId || !templateId || !publicKey) {
      console.error('EmailJS environment variables missing');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Configuration serveur incomplète' })
      };
    }

    // Construction de la requête vers EmailJS
    const emailjsBody = {
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      template_params: params
    };
    // Si on a une clé privée (accessToken), on l'ajoute — nécessaire si
    // "Strict Authentication" est activé côté EmailJS
    if (privateKey) {
      emailjsBody.accessToken = privateKey;
    }

    // Appel EmailJS depuis le serveur Netlify
    const emailjsResponse = await fetch(
      'https://api.emailjs.com/api/v1.0/email/send',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Depuis un serveur, on précise une origine acceptée
          'Origin': 'https://translatetheworld.com'
        },
        body: JSON.stringify(emailjsBody)
      }
    );

    // Si EmailJS renvoie une erreur, on la remonte au navigateur
    if (!emailjsResponse.ok) {
      const errText = await emailjsResponse.text();
      console.error('EmailJS API error:', emailjsResponse.status, errText);
      return {
        statusCode: emailjsResponse.status,
        body: JSON.stringify({
          error: 'EmailJS a refusé la requête',
          status: emailjsResponse.status,
          details: errText
        })
      };
    }

    // Succès
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true })
    };

  } catch (err) {
    // Filet de sécurité : n'importe quelle autre erreur
    console.error('Function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Erreur serveur interne',
        details: err.message
      })
    };
  }
};
