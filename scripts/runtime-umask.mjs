// Applies to local startup and to explicit container/bootstrap preloads.
if (process.platform !== 'win32') process.umask(0o077);
