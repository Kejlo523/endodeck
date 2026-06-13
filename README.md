# EndoDeck

Lokalny Stream Deck z telefonu Huawei P8 Lite, sterowany przez USB i `adb reverse`. Telefon nie potrzebuje Wi-Fi ani usług Google, a wszystkie akcje wykonuje serwer na Windows.

## Najważniejsze funkcje

- 12 dużych kafelków z centralnymi ikonami Font Awesome, dopasowanych do ekranu 1280 x 720
- globalne skróty Discorda działające także wtedy, gdy Discord nie jest aktywnym oknem
- multimedia, programy, skróty Windows, sekwencje akcji i mikser głośności aplikacji
- Studio PC do edycji kafelków, kolejności, kolorów i akcji, z wyszukiwalnym katalogiem ponad 140 ikon
- wybór miasta z listy lub bezpośrednio z mapy OpenStreetMap
- regulowany kolor akcentu, przyciemnienie i wygaszacz z pogodą na siedem dni oraz sekundami przy zegarze
- pasek stanu z połączeniem USB, prądem baterii i poziomem naładowania
- lokalny ekran `PODŁĄCZ KOMPUTER`, gdy serwer lub przewód USB jest niedostępny
- moduły Magisk do uśpienia po odłączeniu, wyłączenia radia, DT2W i usunięcia blokady
- dwuczęściowa obudowa P8 Lite gotowa do druku 3D

## Uruchomienie

```powershell
.\scripts\start-endodeck.ps1
```

Studio konfiguracji:

```powershell
.\scripts\open-editor.ps1
```

Można je również otworzyć pod adresem `http://127.0.0.1:8765/editor.html`.

Instalacja lub aktualizacja aplikacji na telefonie:

```powershell
.\scripts\build-android.ps1
.\scripts\install-phone.ps1
```

Automatyczny start razem z Windows:

```powershell
.\scripts\install-autostart.ps1
```

## Magisk

Gotowe paczki znajdują się w `dist`:

- `EndoDeck-Power-Guard-Magisk.zip` monitoruje hosta USB, wyłącza Wi-Fi, Bluetooth, dane, lokalizację i modem przez tryb samolotowy, a po 45 sekundach od odłączenia wygasza ekran i wymusza deep idle.
- `EndoDeck-Touch-Wake-Magisk.zip` włącza sprzętowe double-tap-to-wake Huawei i wyłącza ekran blokady.

Instalacja obu paczek przez ADB i Magisk:

```powershell
.\scripts\install-magisk.ps1
```

Po instalacji wymagany jest restart telefonu. Czas do uśpienia i zachowanie trybu samolotowego można zmienić w `magisk/endodeck-power-guard/config.conf`, a następnie ponownie zbudować i zainstalować moduł.

## Akcje i dźwięk

Obsługiwane typy akcji to `hotkey`, `processHotkey`, `microphoneMute`, `media`, `launch`, `command`, `sequence` i `page`. `processHotkey` na chwilę aktywuje wskazany proces, wysyła skrót i przywraca poprzednie okno. `microphoneMute` steruje domyślnym wejściem Windows przez Core Audio, a kafel pokazuje jego rzeczywisty stan nawet po zmianie wykonanej poza EndoDeck.

Kafle programów mogą mieć źródło stanu `process`, dlatego Discord i Spotify podświetlają się tylko wtedy, gdy odpowiadający proces faktycznie działa. Stan natywnego mute/deafen wewnątrz klienta Discord nie jest wystawiany przez Windows; przycisk mikrofonu używa więc systemowego mute, które jest mierzalne i skutecznie odcina mikrofon we wszystkich aplikacjach.

Mikser używa Windows Core Audio. Pokazuje poziom systemowy oraz aplikacje mające aktywną sesję dźwięku. Aplikacja pojawi się po rozpoczęciu odtwarzania lub wygenerowaniu dźwięku.

Wartość mA pochodzi z czujnika baterii telefonu. Jest najlepszym dostępnym przybliżeniem bilansu energii, ale P8 Lite nie udostępnia osobnego czujnika prądu wejściowego USB.

Interfejs korzysta z [Font Awesome Free](https://fontawesome.com/license/free) oraz [Leaflet](https://leafletjs.com/). Warstwa mapy pochodzi z [OpenStreetMap](https://www.openstreetmap.org/copyright), a wyszukiwanie i odwrotne geokodowanie są wykonywane przez backend z ograniczeniem częstotliwości zapytań.

## Obudowa 3D

Modele w `dist`:

- `EndoDeck-P8Lite-Front-Bezel.stl`
- `EndoDeck-P8Lite-Rear-Stand.stl`

Telefon jest dociskany między częściami skręcanymi czterema śrubami M3 x 10 mm. Szczegóły wymiarów, pianki i ustawień druku znajdują się w `enclosure/README.md`.
