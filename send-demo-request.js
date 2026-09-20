// ─────────────────────────────────────────────────────────────
//  Netlify Function : send-demo-request
//
//  Rôle : recevoir les demandes de démonstration depuis le
//  formulaire de la modale "Demander une démonstration gratuite",
//  puis envoyer l'email à info@sogedicom.com via EmailJS depuis
//  le serveur (jamais depuis le navigateur du client).
//
//  Cela résout définitivement les problèmes de "Load failed" en
//  4G sur iPhone Safari, comme pour le formulaire d'essai gratuit.
//
//  Appelée automatiquement quand le navigateur fait un POST vers :
//    /.netlify/functions/send-demo-request
// ─────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  // On n'accepte que les requêtes POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Lecture et validation des données envoyées par le navigateur
    const body = JSON.parse(event.body || '{}');
    const name = (body.name || '').trim();
    const org = (body.org || '').trim();
    const email = (body.email || '').trim();
    const phone = (body.phone || '').trim();
    const message = (body.message || '').trim();

    if (!name || !email || !phone || !message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Champs obligatoires manquants (nom, email, téléphone, message).' })
      };
    }

    // Récupération des identifiants EmailJS depuis les variables Netlify
    const serviceId  = process.env.EMAILJS_SERVICE_ID;
    const publicKey  = process.env.EMAILJS_PUBLIC_KEY;
    const privateKey = process.env.EMAILJS_KEY; // accessToken

    // Template dédié aux demandes de démo (identique à celui utilisé
    // pour la prise de RDV côté hôte — c'est le même flux commercial)
    const templateId = 'template_ofhz8y6';

    if (!serviceId || !publicKey) {
      console.error('EmailJS environment variables missing');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Configuration serveur incomplète' })
      };
    }

    // Construction du corps du message pour l'email
    const emailBody =
      'NOUVELLE DEMANDE DE DÉMONSTRATION\n' +
      '─────────────────────────────────\n\n' +
      'Nom : ' + name + '\n' +
      'Organisation : ' + (org || '—') + '\n' +
      'Email : ' + email + '\n' +
      'Téléphone : ' + phone + '\n\n' +
      'BESOIN EXPRIMÉ :\n' +
      message;

    // Requête vers l'API EmailJS
    const emailjsPayload = {
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      template_params: {
        to_email: 'info@sogedicom.com',
        from_name: name,
        from_org: org || '—',
        from_email: email,
        from_phone: phone,
        message: emailBody,
        reply_to: email
      }
    };
    if (privateKey) {
      emailjsPayload.accessToken = privateKey;
    }

    const emailjsResponse = await fetch(
      'https://api.emailjs.com/api/v1.0/email/send',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://translatetheworld.com'
        },
        body: JSON.stringify(emailjsPayload)
      }
    );

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
