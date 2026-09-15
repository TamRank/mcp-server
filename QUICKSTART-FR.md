# TamRank MCP — démarrer sur votre propre site de test

TamRank vous aide à trouver les tâches SEO pertinentes, à examiner les éléments
qui les justifient et à exécuter les modifications prises en charge après votre
accord. Commencez par la lecture seule.

**Utilisez d'abord cette bêta sur votre propre site de test. N'activez ses
fonctions d'écriture sur un site client qu'après une validation de publication distincte.**
Ce guide ne modifie aucun réglage et n'accorde aucun droit supplémentaire à l'IA.
La traduction ne change ni la langue des réponses MCP ni celle de l'interface WordPress.

## 1. Prérequis

- Votre propre site de test, avec les versions bêta FREE et PRO correspondantes.
  Dans TamRank, activez le profil de workflow sûr avec le PAT de configuration.
  La première activation exige les cinq droits sélectionnés par TamRank :
  lecture du site, jeux de modifications, métadonnées, audit et restauration.
  Cela ne constitue pas une autorisation permanente de modifier le site.
- Un client MCP capable de lancer un programme local via stdio, et Node.js.
  Les versions testées et leurs limites figurent dans le [guide anglais](README.md).
- Un **PAT propre au site** : un jeton d'accès créé dans TamRank,
  **Settings → Integrations → AI Agents (MCP)**, sur ce site de test. Pour une
  première connexion client strictement en lecture seule, créez après
  l'activation un second PAT limité à `site:read` et utilisez-le dans le client.
  Une clé de licence n'est pas un PAT. Ne partagez pas le jeton dans les
  conversations, captures d'écran ou tickets et ne le stockez pas dans git.
- Pour administrer les tâches, créez un PAT distinct limité à `site:read` et
  `tasks:write`. Le PAT de configuration obligatoire n'inclut volontairement
  aucun droit de gestion des tâches.

## 2. Créer une connexion de test distincte

Utilisez la bêta épinglée `@tam-rank/mcp-server` / `0.4.0-beta.1`. `npx`,
`npm start`, `tamrank-mcp`, `index-workflow.js` et le chemin de compatibilité
`index.js` lancent le même workflow sûr, identifié comme
`tamrank-mcp` / `0.4.0-beta.1`.

Avant la publication effective de cette bêta dans npm, installez le fichier
`.tgz` fourni dans un répertoire local vide :

```bash
npm install --prefix /chemin/absolu/tamrank-mcp-test \
  /chemin/absolu/tam-rank-mcp-server-0.4.0-beta.1-candidate.tgz
```

Remplacez l'URL d'exemple, le chemin absolu et le jeton fictif dans les
réglages locaux de votre client. Cet exemple convient aux clients utilisant
`mcpServers` ; les autres utilisent la même commande, les mêmes arguments et
variables d'environnement dans leurs propres réglages. Votre connexion existante
reste séparée.

```json
{
  "mcpServers": {
    "tamrank-test": {
      "command": "node",
      "args": ["/absolute/path/tamrank-mcp-test/node_modules/@tam-rank/mcp-server/index-workflow.js"],
      "env": {
        "TAMRANK_SITE_URL": "https://test.example.com",
        "TAMRANK_PAT": "REPLACE_WITH_SITE_LOCAL_PAT",
        "TAMRANK_TOOL_PROFILE": "core"
      }
    }
  }
}
```

La configuration plus courte avec `npx -y @tam-rank/mcp-server@0.4.0-beta.1`
ne fonctionnera qu'après la publication
effective de cette version avec le tag bêta dans le registre npm public.

Le profil `core`
propose 12 noms d'outils, `specialist` 20 et `legacy` 42. Un outil visible ne
signifie pas que son exécution est autorisée. Les anciennes fonctions d'écriture
ne servent pas de solution de repli.

## 3. Vérifier d'abord, sans rien modifier

Redémarrez uniquement cette connexion de test, puis demandez :

> Vérifie quel site est connecté et quelles fonctions sont disponibles. Montre
> les trois tâches existantes les plus importantes et, séparément, les signaux,
> avec leurs éléments justificatifs et périodes de mesure. Ne crée aucune tâche,
> ne lance aucun scan et ne modifie rien.

Premiers appels : `get_site_context`, `get_capabilities`, `get_work_queue`, `get_signals`.

Vérifiez qu'il s'agit du bon site. Pour un groupe, récupérez toutes les pages
grâce aux curseurs renvoyés ; quatre lignes d'aperçu ne constituent pas la liste complète.

## 4. Ensuite seulement : un test d'écriture autorisé séparément

Uniquement si l'opération concernée est disponible sur votre propre site de test
et si les droits nécessaires ont été accordés séparément :

1. Faites préparer une proposition avec `plan_changes`. Examinez **toutes** les
   pages, anciennes et nouvelles valeurs, alertes et confirmations requises.
2. Donnez votre accord explicite dans la conversation. Une proposition enregistrée
   n'est pas une autorisation. `execute_change_set` ne peut exécuter que cette
   proposition inchangée. Toute modification nécessite un nouvel accord.
3. Vérifiez avec `get_changes` ce qui a réellement été exécuté. En cas de délai
   dépassé ou de réponse perdue, relisez d'abord cette même exécution ; ne relancez
   pas automatiquement l'écriture et ne créez pas un nouveau lot de modifications.
4. Un retour en arrière commence par une nouvelle proposition
   `rollback_change_set` et un **nouvel accord**. Des modifications ultérieures
   ou des preuves manquantes peuvent empêcher la restauration.

WordPress conserve une attestation d'accord dans la conversation, pas la conversation
elle-même. Il ne peut pas vérifier indépendamment ce que vous y avez dit.
Cocher une recherche terminée n'autorise pas une modification de page et ne prouve
pas une amélioration SEO. Les scans et la récupération d'exécutions interrompues
nécessitent leurs propres accords ; `get_scan_status` ne reprend rien.

Le profil actuel `safe-beta-1` exécute uniquement les métadonnées, les champs
sociaux et les textes alternatifs des pièces jointes. L'exécution des
redirections, des schémas et des scans reste désactivée côté serveur, même si
des implémentations de développement distinctes et limitées existent. Il ne
modifie ni le contenu des pages ni les constructeurs de pages, n'ajoute aucun
lien interne automatique, JSON-LD arbitraire ou nouveau modèle de schéma. Tout
n'est pas réversible. La mesure du résultat SEO relève de la phase 5.

## Si la connexion échoue

- **Mauvais site ou redirection :** utilisez l'URL définitive du site. TamRank
  ne transmet pas votre PAT à travers les redirections.
- **Accès refusé :** vérifiez le jeton, l'appartenance de l'utilisateur au site
  et ses droits. N'élargissez pas les droits simplement pour faire disparaître une erreur.
- **Fonction indisponible :** faites vérifier les versions de développement et
  les fonctions côté serveur. Le mode aperçu ne permet pas de les contourner.
- **Erreur TLS :** corrigez la confiance dans le certificat ; ne désactivez pas
  la vérification TLS. HTTPS est requis. Seuls les hôtes de test littéraux
  `localhost`, `127.0.0.1` et `[::1]` peuvent utiliser HTTP, pas un nom en `.local`.
- **Route REST introuvable :** vérifiez le chemin du site. Utilisez
  `TAMRANK_REST_STYLE=query` uniquement si ce site nécessite cette forme de routage.
- **Limite atteinte :** respectez le délai indiqué ; pas de boucle de relance
  automatique ni de nouveau jeton pour contourner la limite.

## Plusieurs sites de clients

Utilisez ensuite un nom de connexion distinct, une URL exacte et un PAT propre
à chaque site. Vérifiez le site cible avant chaque proposition. L'accord pour
le client A ne vaut pas pour le client B. Cela n'implémente ni sélecteur central
de sites, ni vue de portefeuille, ni accord groupé entre clients. L'activation
sur les sites de clients reste une étape distincte.

Le [guide anglais](README.md) détaille les outils et les réglages de transport.
Les preuves de développement internes ne sont volontairement pas incluses dans
le paquet client ; un test réussi ne valide pas tous les hébergements.
