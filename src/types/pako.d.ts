declare module 'pako' {
  const pako: {
    ungzip(data: Uint8Array): Uint8Array
  }
  export default pako
}
