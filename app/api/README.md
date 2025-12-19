# API

## Run

Use Nx to run locally (`nx run api:serve`). This wraps the dev server in a process manager with watch mode, `.env` loading, and a debugger. In production we don't want those things and instead we execute the plain built artifact with the `node` cli. Note that the script you may see in package.json serves the latter purpose and won't work locally unless you load environment variables through external means.

## Database

We use Prisma as the ORM. We used to use TypeORM, but its development and maintenance status is questionable and there are many long-standing bugs. Additionally, we'd like to move to an inverted SQL-first schema migration process instead of being app-code-first, and TypeORM doesn't support that.

### Migrations

The app runs migrations on startup, and there is also a command (mentioned below) to run them without starting the app. Migrations are plain SQL files organized according to a convention defined by the simple Postgrator library.

In general we should only write "do" migrations and not bother with "undo". Undo isn't very useful, partly because we don't have a way to run them. If a migration needs to be reverted for some reason, we can add another that undoes it. That's how we have to do it in Git anyway. It's still important to review and carefully test migrations, and maybe in some cases to think about how they could be reverted, but we shouldn't bother including an "undo" for each "do" as a matter of course.

- Make a new SQL file according to [Postgrator's naming scheme](https://www.npmjs.com/package/postgrator#usage).
- Run `npm run api:migrate-local-dev`
- Run `npm run prisma:db-pull-and-generate`
  - Alternatively, you can run the `db-pull` and `generate-client` scripts individually:
    - Run `npm run prisma:db-pull`
    - Run `npm run prisma:generate-client`
- Propagate the changes through app code as necessary.
- If you want to, regenerate the ERD (open output from either option below in a browser: [api/schemaspy/output/index.html](api/schemaspy/output/index.html)):
  - `npm run api:generate-erd-local`
