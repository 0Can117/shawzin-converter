# Shawzin Kod Dönüştürücü

MIDI dosyasını ya da yazdığın notaları Warframe Shawzin koduna çeviren statik bir web sitesi. Sunucu gerektirmez, her şey tarayıcıda çalışır.

## Özellikler

- MIDI yükleme, melodi kanalı seçimi (en uygun kanal otomatik işaretlenir)
- Nota metni girişi (`E5:1 F#4:2 Mi5 r:2 ~:4`)
- Ölçek otomatik seçimi (9 Shawzin ölçeği) ve oktav kaydırma
- Hız ayarı, boşluk kısaltma, uzun bas notalarını eleme
- Normal ve hızlı mod, 4096 konum sınırı uyarısı
- Tarayıcıda önizleme (kaba bir sentezleyici, oyun sesi değil)
- Kod ve `pozisyon+harf` listesi çıktısı

## Kod nasıl üretiliyor

`kod = ölçek rakamı + her nota için 3 karakter`

- Ölçek rakamı: 1 Pentatonic Minor, 2 Pentatonic Major, 3 Chromatic, 4 Hexatonic, 5 Major, 6 Minor, 7 Hirajoshi, 8 Phrygian, 9 Yo.
- 1. karakter: ölçeğin 12 notasından hangisi (A en alçak, L en yüksek).
- 2. ve 3. karakter: notanın konumu (1-4096), 64'lük sayı sisteminde. Normal modda konum başına 0,125 sn, hızlı modda 0,0625 sn.

## Sınırlar

- Yalnızca tek sesli melodi çıkarır. Aynı anda gelen notalardan en tiz olan alınır.
- Shawzin'de nota süresi yoktur. Bağlı ve uzun notalar tek vuruş olur.
- Melodi bir ölçeğin 12 notasına sığmazsa notalar oktav kaydırılır ya da en yakın notaya yuvarlanır.
- Vokal içermeyen MIDI dosyalarında yalnızca enstrümantal hat çıkar.


## Credits & Acknowledgements

This project is an independent implementation of a MIDI-to-Shawzin converter, built with reference to the Shawzin code format and encoding system established by the original project.

**Original Project:** [Warframe-shawzin](https://github.com/DANser-freelancer/Warframe-shawzin)  
**Original Author:** [DANser-freelancer](https://github.com/DANser-freelancer)

The original project served as a reference for the Shawzin note character mapping and timing/position encoding format.

The MIDI parsing, automatic scale detection, note processing, timing conversion, and conversion workflow in this project are independently implemented.

This project is not an official fork of or affiliated with the original project or Digital Extremes.

**License:** GNU Affero General Public License v3.0 (AGPL-3.0).
