# Agent SAV e-commerce (v1) — AIBOS

## Périmètre

Suivi de commande / livraison uniquement, sur Shopify.

**Géré par l'agent :**
- Identification de la commande (par n° ou email client)
- Lecture du statut (pending → processing → shipped → delivered)
- Lecture des informations de tracking (transporteur, URL, ETA)
- Réponse en langage naturel basée sur les données réelles Shopify

**Hors périmètre (escalade humaine) :**
- Remboursements
- Modifications de commande
- Annulations
- Litiges
- Clients très frustrés

## Architecture

```
Client (chat)
  ↓
ConversationsModule → AgentRuntime
  ↓
Agent "agent-sav-suivi-commande" (Claude 3.5 Haiku, temp 0.2)
  ↓ (function calling)
Tools enregistrés dans le registre :
  - getOrderByNumber(orderNumber)
  - getOrdersByCustomerEmail(email, limit)
  - getOrderStatus(orderId)
  - getTrackingInfo(orderId)
  - escalateToHuman(reason)
  ↓
EcommerceService → ShopifyConnector (Admin API REST)
  ↓
Shopify Admin API
```

L'interface `EcommerceConnector` est agnostique du provider. Ajouter WooCommerce
plus tard = implémenter `WooCommerceConnector` + ajouter le switch dans
`EcommerceService.buildConnector()`. Aucun changement requis dans les tools
ou l'agent.

## Setup

### 1. Créer une Custom App Shopify

Dans l'admin Shopify : **Settings → Apps and sales channels → Develop apps**

1. Créer une app
2. Onglet **API access scopes**, cocher **uniquement** :
   - `read_orders`
   - `read_fulfillments`
3. Onglet **API credentials**, **Install app** puis **Reveal token once**
4. Noter le token (`shpat_…`)

### 2. Connecter la boutique à AIBOS

```bash
POST /api/v1/integrations/ecommerce/shopify
{
  "shopDomain": "ma-boutique.myshopify.com",
  "accessToken": "shpat_..."
}
```

Le token est chiffré en base (AES-256-CBC).

### 3. Cloner l'agent template

Le seed crée automatiquement l'agent `agent-sav-suivi-commande` comme
template. Pour l'utiliser dans une organisation :

```bash
GET /api/v1/agents/templates                          # trouve le template
POST /api/v1/agents/{agentId}/clone/{templateId}      # clone dans l'org
```

L'agent cloné démarre en `DRAFT`. Le déployer :

```bash
POST /api/v1/agents/{agentId}/deploy
```

### 4. Tester

```bash
POST /api/v1/conversations
{ "agentId": "<cloned-agent-id>" }

POST /api/v1/conversations/{conversationId}/messages
{ "message": "Bonjour, où en est ma commande #1001 ?" }
```

## Mesure de succès (v1)

- % de tickets résolus sans escalade (à tracker via le flag `needsHumanReview` dans `conversation.metadata`)
- Temps de réponse moyen (à tracker via `usage_records.durationMs`)
- 0% d'invention de données (tester manuellement ~20 cas avant prod)

## Limites connues v1

- 1 provider e-commerce par organisation (suffisant pour v1)
- Pas de cache des appels Shopify (chaque question = 1 appel API)
- Pas de retry sur erreur Shopify transitoire
- Pas de pagination sur `getOrdersByCustomerEmail` (limite 5 par défaut)
- Frontend : pas d'UI Agent Builder (utiliser l'API ou Prisma Studio pour configurer)

## v2 (hors scope v1)

- Connecteur WooCommerce (interface déjà prête)
- Outils d'écriture (refunds, modifications) + validation humaine renforcée
- Relance panier abandonné (flux proactif distinct)
- Cache des commandes Shopify
- UI Agent Builder complète
