const express = require('express');
const path = require('path');

const fieldsRouter = require('./routes/fields');
const exportRouter = require('./routes/export');
const importRouter = require('./routes/import');
const notesRouter = require('./routes/notes');
const companiesRouter = require('./routes/companies');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/fields', fieldsRouter);
app.use('/api/export', exportRouter);
app.use('/api/import', importRouter);
app.use('/api/notes', notesRouter);
app.use('/api/companies', companiesRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Fallback to index.html for client-side routing
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`pb-tools running on port ${PORT}`);
});
