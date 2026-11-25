# Intégration Nkap Pay et Monerails — DORA DIGITAL ACADEMY

Cette intégration est construite sur la page historique `index.html`. Les styles CSS, la structure des sections, les fenêtres de dialogue et la présentation générale sont conservés. Seules les options du sélecteur de paiement existant et sa logique JavaScript changent.

## Parcours disponible dans le code

- Orange Money et Airtel Money : parcours PayCentral historique conservé.
- Nkap Pay : paiement hébergé pour le Tchad ; le client choisit l'opérateur et saisit son numéro sur la page Nkap.
- Monerails — Airtel Money et Monerails — Moov Money : encaissement mobile money XAF avec pays TD, validation téléphone ou OTP selon l'opérateur.

## Fonctions Supabase à déployer

Toutes les fonctions ci-dessous doivent être déployées dans le projet Supabase `wtbxjqamwitwogxdrkwd`.

| Fonction | `verify_jwt` | Rôle |
|---|---:|---|
| `create-alternate-payment` | `false` | Créer la commande et initier Nkap ou Monerails ; vérifie le JWT utilisateur si présent |
| `authorize-monerails-payment` | `false` | Transmettre un OTP Monerails après validation de la commande et de l'e-mail |
| `check-alternate-payment-status` | `false` | Vérifier le statut marchand et restituer le téléchargement invité après confirmation |
| `nkap-webhook` | `false` | Recevoir les événements Nkap et valider leur HMAC |
| `monerails-webhook` | `false` | Recevoir les événements Monerails et valider leur HMAC |

Les webhooks externes ne peuvent pas fournir de JWT Supabase ; leur authentification se fait avec les signatures du prestataire. Ne pas mettre ces fonctions en accès protégé par JWT.

## Secrets à créer dans Supabase

Dans le projet DDA, ouvrir **Edge Functions → Secrets** et ajouter les secrets suivants en mode test uniquement :

### Nkap Pay
- `NKAP_API_KEY` : clé test commençant par `ltcpay_test_`
- `NKAP_API_SECRET` : secret API associé à la clé test
- `NKAP_WEBHOOK_SECRET` : secret HMAC du webhook Nkap

### Monerails
- `MONERAILS_API_KEY` : clé test commençant par `mr_test_`
- `MONERAILS_WEBHOOK_SECRET` : secret de signature `whsec_...` associé au point de terminaison de test Monerails

### Déjà utilisé par la boutique
- `GUEST_TOKEN_ENCRYPTION_KEY` doit rester le même que celui utilisé par les fonctions de téléchargement invité existantes.
- Les variables Supabase par défaut (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`) restent nécessaires et ne doivent pas être remplacées par une clé publiée dans le navigateur.

Ne jamais placer une clé secrète dans `index.html`, dans Git ou dans une conversation. Ne pas définir `NKAP_ALLOW_LIVE=true` ni `MONERAILS_ALLOW_LIVE=true` pendant les tests.

## Webhooks à déclarer chez les prestataires

### Nkap Pay
URL :
`https://wtbxjqamwitwogxdrkwd.supabase.co/functions/v1/nkap-webhook`

Événement à activer : `payment.status_changed`.

La fonction valide la signature HMAC SHA-256 de l'en-tête `X-LtcPay-Signature`, la référence marchande, la référence de paiement, le montant et la devise avant d'appliquer une confirmation. Le statut `EXPIRED` ne clôture pas définitivement une commande, afin de laisser passer une éventuelle confirmation tardive.

### Monerails
Créer un point de terminaison dans le tableau de bord **Développeurs → Webhooks**, en mode test, avec l'URL :
`https://wtbxjqamwitwogxdrkwd.supabase.co/functions/v1/monerails-webhook`

Événements :
- `collection.succeeded`
- `collection.failed`
- `collection.expired`

Lors de la création, conserver le secret `whsec_...` retourné par Monerails dans `MONERAILS_WEBHOOK_SECRET`. Les endpoints et secrets de test et de production sont distincts.

## Tests Sandbox recommandés

### Nkap
1. Choisir un produit publié sur DDA.
2. Choisir Nkap Pay.
3. Vérifier l'ouverture de la page hébergée de Nkap pour le Tchad.
4. Effectuer un paiement de test dans l'environnement Nkap.
5. Vérifier le retour et la réception du webhook signé.
6. Confirmer que la commande passe à `paid` et que le lien de téléchargement ne s'affiche qu'après confirmation.

### Monerails
Pour le Tchad, la documentation Monerails mentionne les numéros de test suivants :
- `+23500000001` : scénario de succès
- `+23500000002` : scénario restant en attente
- `+23500000003` : scénario d'échec

1. Choisir Monerails — Airtel Money ou Monerails — Moov Money.
2. Utiliser un numéro de test approprié.
3. Valider la demande sur le téléphone de test ou renseigner l'OTP si l'API retourne `requires_otp`.
4. Vérifier le webhook et/ou le contrôle de statut.
5. Vérifier l'accès au produit uniquement après le statut `succeeded`.

## Conditions avant mise en production

- Ne pas fusionner la Pull Request ni déployer les nouvelles fonctions avant que les secrets test soient présents.
- Réussir au moins un paiement test Nkap et un paiement test Monerails, avec confirmation du webhook et délivrance du fichier.
- Vérifier les frais et le montant final du côté de chaque prestataire.
- Ne jamais activer les clés live ou les variables `*_ALLOW_LIVE` sans validation commerciale du compte marchand, des opérateurs et des webhooks de production.
- Les anciennes passerelles PayCentral restent présentes dans la page et dans le backend ; cette intégration ne les supprime pas.

## État de cette branche

Le HTML et les fonctions serveur ont passé la vérification de syntaxe/typage Deno et le contrôle de préservation de l'interface. La Pull Request #2 est en attente. Les nouvelles fonctions ne sont pas encore déployées sur Supabase et les transactions test de bout en bout restent à faire après ajout des secrets.
