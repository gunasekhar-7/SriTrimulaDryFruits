import type Database from 'better-sqlite3';
import { SpanKind, SpanStatusCode, trace, context } from '@opentelemetry/api';
import { otelTracer } from './tracer.js';
import { metricsAggregator } from './metrics.js';

function extractOperationAndTable(sql: string): { operation: string; table: string } {
  const cleanSql = sql.trim().replace(/\s+/g, ' ');
  const firstWord = cleanSql.split(' ')[0].toUpperCase();

  let table = 'unknown';

  if (firstWord === 'SELECT') {
    const match = cleanSql.match(/FROM\s+([a-zA-Z0-9_]+)/i);
    if (match) table = match[1];
  } else if (firstWord === 'INSERT') {
    const match = cleanSql.match(/INTO\s+([a-zA-Z0-9_]+)/i);
    if (match) table = match[1];
  } else if (firstWord === 'UPDATE') {
    const match = cleanSql.match(/UPDATE\s+([a-zA-Z0-9_]+)/i);
    if (match) table = match[1];
  } else if (firstWord === 'DELETE') {
    const match = cleanSql.match(/FROM\s+([a-zA-Z0-9_]+)/i);
    if (match) table = match[1];
  } else if (firstWord === 'CREATE' || firstWord === 'ALTER' || firstWord === 'DROP') {
    const match = cleanSql.match(/TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?([a-zA-Z0-9_]+)/i);
    if (match) table = match[1];
  }

  return { operation: firstWord || 'QUERY', table };
}

export function instrumentDatabase(db: Database.Database): Database.Database {
  const originalPrepare = db.prepare.bind(db);
  const originalTransaction = db.transaction.bind(db);

  // Wrap db.prepare
  db.prepare = function (sql: string): any {
    const stmt = originalPrepare(sql);
    const { operation, table } = extractOperationAndTable(sql);

    const wrapMethod = (origFn: Function, methodName: string) => {
      return function (this: any, ...args: any[]) {
        const startHr = process.hrtime();
        const activeSpan = trace.getSpan(context.active());
        let dbSpan: any = null;

        // If there's an active distributed trace, create a child DB span
        if (activeSpan) {
          dbSpan = otelTracer.startSpan(`db.query: ${operation} ${table}`, {
            kind: SpanKind.CLIENT,
            attributes: {
              'db.system': 'sqlite',
              'db.name': 'store.db',
              'db.operation': operation,
              'db.table': table,
              'db.method': methodName,
              'db.statement': sql.length > 200 ? sql.slice(0, 200) + '...' : sql
            }
          });
        }

        try {
          const result = origFn.apply(this, args);
          const diff = process.hrtime(startHr);
          const durationSeconds = diff[0] + diff[1] / 1e9;

          if (dbSpan) {
            dbSpan.setAttribute('db.duration_ms', Number((durationSeconds * 1000).toFixed(2)));
            dbSpan.setStatus({ code: SpanStatusCode.OK });
            dbSpan.end();
          }

          metricsAggregator.recordDbQuery(operation, table, durationSeconds, true);
          return result;
        } catch (error: any) {
          const diff = process.hrtime(startHr);
          const durationSeconds = diff[0] + diff[1] / 1e9;

          if (dbSpan) {
            dbSpan.recordException(error);
            dbSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: error.message
            });
            dbSpan.end();
          }

          metricsAggregator.recordDbQuery(operation, table, durationSeconds, false);
          throw error;
        }
      };
    };

    stmt.run = wrapMethod(stmt.run.bind(stmt), 'run');
    stmt.get = wrapMethod(stmt.get.bind(stmt), 'get');
    stmt.all = wrapMethod(stmt.all.bind(stmt), 'all');

    return stmt;
  };

  // Wrap db.transaction
  db.transaction = function (fn: any): any {
    const wrappedTx = (originalTransaction as any)(fn);

    return function (this: any, ...args: any[]) {
      const startHr = process.hrtime();
      const activeSpan = trace.getSpan(context.active());
      let txSpan: any = null;

      if (activeSpan) {
        txSpan = otelTracer.startSpan('db.transaction', {
          kind: SpanKind.CLIENT,
          attributes: {
            'db.system': 'sqlite',
            'db.name': 'store.db',
            'db.operation': 'TRANSACTION'
          }
        });
      }

      try {
        const result = wrappedTx.apply(this, args);
        const diff = process.hrtime(startHr);
        const durationSeconds = diff[0] + diff[1] / 1e9;

        if (txSpan) {
          txSpan.setAttribute('db.duration_ms', Number((durationSeconds * 1000).toFixed(2)));
          txSpan.setStatus({ code: SpanStatusCode.OK });
          txSpan.end();
        }

        metricsAggregator.recordDbQuery('TRANSACTION', 'transaction', durationSeconds, true);
        return result;
      } catch (error: any) {
        const diff = process.hrtime(startHr);
        const durationSeconds = diff[0] + diff[1] / 1e9;

        if (txSpan) {
          txSpan.recordException(error);
          txSpan.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message
          });
          txSpan.end();
        }

        metricsAggregator.recordDbQuery('TRANSACTION', 'transaction', durationSeconds, false);
        throw error;
      }
    };
  };

  return db;
}
