import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const projectDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const prismaDir = join(projectDir, 'server', 'prisma')
const migrationsDir = join(prismaDir, 'migrations')
const databasePath = join(prismaDir, 'dev.db')

const database = new DatabaseSync(databasePath)
database.exec('PRAGMA foreign_keys = ON;')

for (const migration of readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()) {
  const sql = readFileSync(join(migrationsDir, migration, 'migration.sql'), 'utf8')
  database.exec(sql)
  console.log(`Applied ${migration}`)
}

database.close()
console.log(`Initialized ${databasePath}`)
