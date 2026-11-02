Pod::Spec.new do |s|
  s.name           = 'PiuTransport'
  s.version        = '0.1.0'
  s.summary        = 'Transporte P2P do Piu (Bluetooth LE)'
  s.description    = 'Descoberta e troca de envelopes cifrados entre aparelhos por perto, sem internet.'
  s.author         = ''
  s.homepage       = 'https://github.com/lunes-platform/piu.'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreBluetooth'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,swift}"
end
