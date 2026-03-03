# Rehab Link MVP

Prototype React/Vite pour relier le praticien et son patient sur les exercices de rééducation.

## Stack base de données

- SQLite (fichier local)
- Prisma (ORM + schéma)
- API Express (persistante, sans fallback localStorage)

## Installation

```bash
npm install
```

## Initialiser la base

```bash
npm run prisma:generate
npm run db:push
```

## Démarrer le projet

```bash
npm run dev
```

Le script lance:

- l'API Prisma/SQLite sur `http://localhost:8787`
- l'interface web Vite sur `http://localhost:5173`

## Variables d'environnement

Fichier `.env`:

- `DATABASE_URL` (ex: `file:./prisma/dev.db`)
- `API_PORT` (par défaut `8787`)
- `VITE_API_BASE_URL` (laisser vide en local avec proxy Vite)

## Persistance

- Lecture/écriture uniquement via SQLite + Prisma.
- Aucun fallback `localStorage` ou Supabase n'est utilisé.