import CryptoKit
import ExpoModulesCore
import Foundation

/**
 * HTTPS para o piu-node da rede local com o certificado autoassinado FIXADO pela impressão digital
 * SHA-256 que o console e o painel mostram. O pino substitui a cadeia de autoridades e a conferência
 * do nome (o nó é `piu-node.local` ou um IP). Sem redirecionamento, sem cookies automáticos.
 * No iPhone, a primeira conexão pede a permissão de rede local (NSLocalNetworkUsageDescription).
 */
public final class PiuNodeLinkModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PiuNodeLink")

    AsyncFunction("request") { (url: String, method: String, headers: [String: String], body: String?, pin: String, promise: Promise) in
      guard let u = URL(string: url), u.scheme == "https" else { promise.reject("ERR_NODE_LINK", "Só HTTPS."); return }
      let expected = pin.replacingOccurrences(of: ":", with: "").lowercased()
      guard expected.count == 64 else { promise.reject("ERR_NODE_LINK", "Impressão digital inválida."); return }
      var req = URLRequest(url: u, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
      req.httpMethod = method
      req.httpShouldHandleCookies = false
      for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
      if let body = body, method != "GET" { req.httpBody = body.data(using: .utf8) }
      let delegate = PinnedDelegate(pin: expected)
      let config = URLSessionConfiguration.ephemeral
      config.httpCookieStorage = nil
      config.urlCache = nil
      let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
      session.dataTask(with: req) { data, response, error in
        defer { session.finishTasksAndInvalidate() }
        if let error = error {
          promise.reject("ERR_NODE_LINK", delegate.mismatch ? "A impressão digital do certificado não confere." : error.localizedDescription)
          return
        }
        guard let http = response as? HTTPURLResponse else { promise.reject("ERR_NODE_LINK", "Resposta inválida."); return }
        let bytes = data ?? Data()
        guard bytes.count <= 1024 * 1024 else { promise.reject("ERR_NODE_LINK", "Resposta grande demais."); return }
        var out: [String: String] = [:]
        for (k, v) in http.allHeaderFields { out[String(describing: k)] = String(describing: v) }
        // Tipo explícito: um literal heterogêneo sem anotação não compila ("heterogeneous collection literal").
        let result: [String: Any] = ["status": http.statusCode, "headers": out, "body": String(data: bytes, encoding: .utf8) ?? ""]
        promise.resolve(result)
      }.resume()
    }
  }
}

/// `@unchecked Sendable`: os SDKs novos exigem delegados `Sendable`; `mismatch` só é escrito na fila do delegado
/// antes do fim da tarefa e lido depois, no retorno dela.
private final class PinnedDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  let pin: String
  var mismatch = false
  init(pin: String) { self.pin = pin }

  func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
          let trust = challenge.protectionSpace.serverTrust,
          let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
          let leaf = chain.first else {
      completionHandler(.cancelAuthenticationChallenge, nil); return
    }
    let der = SecCertificateCopyData(leaf) as Data
    let got = SHA256.hash(data: der).map { String(format: "%02x", $0) }.joined()
    if got == pin {
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      mismatch = true
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }

  // Sem redirecionamento: a resposta 3xx volta como está.
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
    completionHandler(nil)
  }
}
