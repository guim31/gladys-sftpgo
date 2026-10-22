# SFTPGo

[SFTPGo](https://sftpgo.com/) est un serveur de fichiers libre (SFTP, FTP/S,
WebDAV et web) que beaucoup font tourner à la maison : un scanner y envoie ses
PDF, une caméra ses images, un téléphone ses photos. Cette intégration amène un
serveur SFTPGo dans Gladys : les connexions en cours, les utilisateurs et leurs
quotas, et surtout un déclencheur de scène **quand un fichier est déposé**, avec
son utilisateur, son chemin, sa taille et son protocole. Elle prévient aussi
quand un quota dépasse un seuil ou qu'une connexion est refusée, et un widget du
tableau de bord liste les derniers fichiers déposés.

Testée sur un vrai SFTPGo 2.7 (images Docker `drakkan/sftpgo` et
`drakkan/sftpgo:plugins` avec PostgreSQL) : dépôts en SFTP et WebDAV, quotas,
connexions refusées, clé d'API et mot de passe d'admin, avec et sans journal
d'événements. Pas encore testée sur un vrai Gladys : retours bienvenus dans
[les issues](https://github.com/guim31/gladys-sftpgo/issues).

## Ce qu'il faut

- Gladys Assistant 5.1.0 ou plus récent.
- SFTPGo 2.x avec son serveur web (port 8080 par défaut) joignable depuis la
  machine de Gladys : l'intégration utilise son API REST (`/api/v2`).
- Un **admin** SFTPGo (pas un utilisateur du serveur de fichiers) avec les
  permissions `view_users`, `view_conns` et `view_events` : le mieux est un admin
  réservé à Gladys. Soit sa clé d'API, soit son identifiant et son mot de passe.
- Pour les dépôts et les connexions refusées : le **journal d'événements** de
  SFTPGo, c'est-à-dire ses plugins `eventstore` et `eventsearch` (voir plus
  bas). Sans lui, connexions, utilisateurs et quotas fonctionnent, mais pas les
  dépôts.

L'intégration lit SFTPGo toutes les 30 secondes par défaut : quelques requêtes
légères sur votre propre réseau.

## Mise en route

### 1. Créer un admin pour Gladys

Dans l'administration web de SFTPGo, **Admins → Add** : un identifiant, un mot
de passe, et seulement les permissions `view_users`, `view_conns` et
`view_events`. Pour utiliser plutôt une clé d'API, cochez « API key
authentication » dans le profil de cet admin, puis créez une clé dans **API
keys** (portée « Admin »).

### 2. Activer le journal d'événements (pour les dépôts)

Les dépôts viennent du journal d'événements de SFTPGo, écrit et lu par deux
plugins fournis dans l'image `drakkan/sftpgo:plugins`. Ils demandent une base
PostgreSQL ou MySQL (SQLite n'est pas prise en charge par les plugins). Avec
Docker Compose, ajoutez à l'`environment` de SFTPGo :

```
SFTPGO_PLUGINS__0__TYPE: notifier
SFTPGO_PLUGINS__0__NOTIFIER_OPTIONS__FS_EVENTS: upload
SFTPGO_PLUGINS__0__NOTIFIER_OPTIONS__LOG_EVENTS: 1,2
SFTPGO_PLUGINS__0__CMD: /usr/local/bin/sftpgo-plugin-eventstore
SFTPGO_PLUGINS__0__ARGS: serve
SFTPGO_PLUGINS__0__AUTO_MTLS: "1"
SFTPGO_PLUGIN_EVENTSTORE_DRIVER: postgres
SFTPGO_PLUGIN_EVENTSTORE_DSN: "host=db user=sftpgo password=… dbname=sftpgo_events sslmode=disable"
SFTPGO_PLUGIN_EVENTSTORE_RETENTION: "720"
SFTPGO_PLUGINS__1__TYPE: eventsearcher
SFTPGO_PLUGINS__1__CMD: /usr/local/bin/sftpgo-plugin-eventsearch
SFTPGO_PLUGINS__1__ARGS: serve
SFTPGO_PLUGINS__1__AUTO_MTLS: "1"
SFTPGO_PLUGIN_EVENTSEARCH_DRIVER: postgres
SFTPGO_PLUGIN_EVENTSEARCH_DSN: "host=db user=sftpgo password=… dbname=sftpgo_events sslmode=disable"
```

`FS_EVENTS: upload` enregistre les dépôts, `LOG_EVENTS: 1,2` les connexions
refusées (mauvais mot de passe, utilisateur inconnu) ; `RETENTION` garde 30
jours. Sans ces plugins, SFTPGo répond « no events searcher plugin defined » et
l'intégration le dit dans son statut et son widget ; elle redemande toutes les
heures.

### 3. Configurer l'intégration

Dans **Intégrations → SFTPGo → Configuration** :

- **Adresse de SFTPGo** : l'adresse de l'interface web, par exemple
  `http://192.168.1.2:8080` (une adresse copiée du navigateur marche aussi).
- **Clé d'API d'admin**, ou **Identifiant de l'admin** et **Mot de passe de
  l'admin**.
- **Fréquence de lecture** : de 10 secondes à 5 minutes. C'est aussi le délai
  de la scène sur un fichier déposé.
- **Seuil d'alerte de quota** : de 70 à 95 %.
- **Langue des noms** : la langue des noms de fonctionnalités et des textes
  envoyés par l'intégration (français par défaut).

**Tester la connexion** répond par exemple « SFTPGo : connecté (2.7.6), 3
utilisateur(s), 1 connexion(s), dépôts suivis ».

### 4. Ajouter les appareils

Dans l'onglet **Découverte**, ajoutez le serveur et les utilisateurs à suivre.
Les déclencheurs de scène fonctionnent pour tous les utilisateurs, ajoutés ou
non.

## Les appareils

**SFTPGo** (le serveur) :

| Fonctionnalité                      | Signification                                |
| ----------------------------------- | -------------------------------------------- |
| **En ligne**                        | 1 tant que SFTPGo répond                     |
| **Dépôts suivis**                   | 1 quand le journal d'événements répond       |
| **Connexions**                      | connexions ouvertes (SFTP, FTP, WebDAV, web) |
| **Transferts en cours**             | envois et téléchargements en cours           |
| **Utilisateurs**                    | utilisateurs du serveur                      |
| **Fichiers déposés aujourd'hui**    | fichiers déposés depuis minuit (journal)     |
| **Connexions refusées aujourd'hui** | connexions refusées depuis minuit (journal)  |

**SFTPGo &lt;utilisateur&gt;** (un par utilisateur) :

| Fonctionnalité                   | Signification                                        |
| -------------------------------- | ---------------------------------------------------- |
| **Quota de taille utilisé**      | % de son quota de taille, 0 sans quota de taille     |
| **Quota de fichiers utilisé**    | % de son quota de fichiers, 0 sans quota de fichiers |
| **Espace utilisé**               | Mo, quand SFTPGo suit le quota de l'utilisateur      |
| **Fichiers**                     | fichiers, même condition                             |
| **Connexions**                   | ses connexions ouvertes                              |
| **Fichiers déposés aujourd'hui** | ses dépôts depuis minuit (journal)                   |
| **Dernier fichier déposé**       | le chemin de son dernier fichier déposé (journal)    |
| **Heure du dernier dépôt**       | jour/mois heures:minutes de ce dépôt (journal)       |

Par défaut SFTPGo ne suit l'espace et les fichiers que des utilisateurs qui ont
un quota (`track_quota` 2) : les autres n'ont ni **Espace utilisé** ni
**Fichiers**.

## Tableau de bord

Le widget **Dépôts SFTPGo** montre trois tuiles (fichiers déposés aujourd'hui,
connexions, connexions refusées du jour), puis les huit derniers fichiers
déposés, du plus récent au plus ancien, avec leur utilisateur et leur heure. Ses
réglages choisissent les utilisateurs montrés (vide : tous). Le bouton
**Actualiser** relit SFTPGo.

## Scènes

### Déclencheurs

- **Un fichier est déposé** : un utilisateur dépose un fichier, par n'importe
  quel protocole. Filtres : utilisateurs, dossier (exactement, ex. `/scans`),
  extension (`pdf`). Variables : utilisateur, chemin, dossier, nom du fichier,
  extension, taille, taille en octets, protocole, adresse du client. Vingt
  dépôts au plus sont annoncés par lecture : un dossier de 500 photos ne lance
  pas 500 scènes.
- **Un quota dépasse le seuil** : un utilisateur dépasse le seuil de la
  configuration (quota de taille ou de fichiers). Une fois, puis à nouveau
  seulement après être redescendu 5 points sous le seuil.
- **Une connexion est refusée** : mauvais mot de passe ou utilisateur inconnu.
  Un événement par utilisateur et adresse à chaque lecture, avec le nombre de
  tentatives.

### Actions

- **État d'un utilisateur** : lit le quota, l'espace utilisé, les connexions,
  les fichiers déposés aujourd'hui et le dernier fichier d'un utilisateur, et
  une phrase toute prête : « scanner : quota utilisé à 42 %, dernier fichier
  /scans/facture.pdf le 22/10 08:12. »

### Idées de scènes

- Un fichier est déposé, dossier `/scans`, extension `pdf` → envoyer « Nouveau
  scan : {{triggerEvent.data.file_name}} » sur Telegram.
- Un fichier est déposé par l'utilisateur « camera » → allumer la lumière de
  l'entrée et envoyer un message.
- Une connexion est refusée → prévenir avec l'adresse et le nombre de
  tentatives.
- Chaque dimanche, État d'un utilisateur → envoyer la phrase.

## Dépannage

- **« SFTPGo ne répond pas »** : vérifiez l'adresse et le port de l'interface
  web (8080 par défaut), depuis la machine de Gladys.
- **« clé d'API, identifiant ou mot de passe refusé par SFTPGo »** : il faut
  les identifiants d'un admin, pas d'un utilisateur. Une clé d'API exige « API
  key authentication » coché dans le profil de l'admin.
- **« l'admin doit avoir les permissions view_users et view_conns »** :
  donnez-les à l'admin de l'intégration.
- **Aucun dépôt vu** : lancez **Tester la connexion**. « pas de journal
  d'événements » signifie que les plugins manquent (étape 2) ; « view_events »,
  que l'admin n'a pas cette permission. Les dépôts faits avant le démarrage de
  l'intégration ne sont pas annoncés, seulement comptés.
- **Pas d'Espace utilisé pour un utilisateur** : SFTPGo ne suit pas son quota ;
  donnez-lui un quota, ou réglez `SFTPGO_DATA_PROVIDER__TRACK_QUOTA=1`.
- Journaux : `LOG_LEVEL=debug` montre chaque lecture et chaque dépôt.

## Limites

- Aucun dépôt n'est vu sans les plugins du journal d'événements. L'intégration
  ne peut pas recevoir les actions HTTP des règles d'événements de SFTPGo : elle
  n'a aucun port ouvert.
- Un dépôt est annoncé à la lecture suivante (30 secondes par défaut).
- Lecture seule : l'intégration ne modifie rien dans SFTPGo.
- Un serveur SFTPGo par intégration ; jusqu'à 2 500 utilisateurs.
- Développée et testée avec un vrai SFTPGo en Docker, pas encore sur toutes les
  installations : retours bienvenus.
