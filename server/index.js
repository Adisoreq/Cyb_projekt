require('./src/app')
  .start()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
