const path = require('path')

module.exports = {
  entry: './src/index.ts',
  mode: 'development',
  output: {
    filename: 'index.js',
    library: 'Automerge',
    libraryTarget: 'umd',
    path: path.resolve(__dirname, 'dist'),
    // https://github.com/webpack/webpack/issues/6525
    globalObject: 'this',
  },
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.(js|ts)$/,
        exclude: /node_modules/,
        use: { loader: 'ts-loader' },
      },
    ],
  },
}
