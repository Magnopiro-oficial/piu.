Pod::Spec.new do |s|
  s.name           = 'PiuNodeLink'
  s.version        = '0.1.0'
  s.summary        = 'HTTPS com certificado fixado para o piu-node da rede local'
  s.description    = 'Conversa com a API local do piu-node aceitando só o certificado com a impressão digital do pareamento.'
  s.author         = ''
  s.homepage       = 'https://github.com/lunes-platform/piu'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
  s.source_files = "**/*.{h,m,swift}"
end
