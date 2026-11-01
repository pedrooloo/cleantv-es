# CleanTV

Pantalla de inicio en español para televisores Samsung con Tizen, pensada para ejecutarse dentro de TizenBrew.

Adaptación de [cleanyourtv-tizen](https://github.com/ledinhtien219/cleanyourtv-tizen),
de ledinhtien219, que a su vez se inspira en [CleanYourTV](https://github.com/Gathin23/cleanyourtv),
de Gathin23, con licencia MIT.

**Sobre la licencia:** el proyecto del que parte esta adaptación no declara ninguna, así
que no hay permiso explícito de redistribución y esto se publica solo como un trabajo
personal, con la atribución a la vista. Si alguien quiere reutilizarlo, lo suyo es
preguntarle antes al autor original.

Probado sobre: Samsung UE75AU7175 (2021), Tizen 6.0, TizenBrew 2.x.

## Qué cambia respecto al original

- Interfaz completa en español, incluidos el día de la semana y los mensajes.
- Cuadrícula de 4 x 3 con fichas más grandes, en lugar de 7 x 3, y pegada a la izquierda:
  así el lado derecho del fondo queda despejado.
- Dock de favoritos en una banda redondeada, al estilo de Apple TV.
- Barra superior navegable con reloj grande y tres accesos: Entradas, Red e Info.
- Paisaje de colinas dibujado en SVG detrás de todo, con sol o luna, árboles en silueta y tres capas de profundidad. Pesa unos 2 KB, no necesita internet y no depende de ninguna foto con licencia.
- Cuatro escenas cálidas que cambian con la hora del día: melocotón al amanecer, ámbar de día, terracota por la tarde y brasa tenue de noche, con una transición de dos segundos entre ellas.
- Saludo sobre el reloj: buenos días, buenas tardes o buenas noches.
- La ayuda de las teclas de color se desvanece a los nueve segundos.
- Samsung TV Plus entre las apps que se fijan solas en el dock la primera vez.
- Panel de entradas que lista las fuentes HDMI conectadas con el nombre que da la tele, y las cambia cuando el televisor lo permite.

## Teclas del mando

| Tecla | Qué hace |
| --- | --- |
| Flechas | Mover el foco. Arriba desde los favoritos lleva a la barra superior |
| OK | Abrir la app, o el acceso de la barra superior |
| Verde | Fijar o quitar de favoritos |
| Rojo / Azul | Página anterior y siguiente |
| Amarillo | Volver a leer las apps instaladas |
| Atrás | Cerrar el panel, o volver a TizenBrew |

## Instalación con TizenBrew

1. Activa el modo desarrollador en la tele: ve a Apps, marca `12345` con el mando, actívalo y pon la IP de tu ordenador.
2. Instala TizenBrew siguiendo [su documentación](https://github.com/reisxd/TizenBrew/blob/main/docs/README.md).
3. En TizenBrew, abre Module Manager, elige **Add GitHub Module** y escribe el nombre de tu repositorio, por ejemplo `tu-usuario/cleantv-es`.

Si ya lo habías añadido, recarga el módulo para que TizenBrew descargue la versión nueva.

## Personalizar

Todo lo que se toca a menudo está en el objeto `CONFIG`, al principio de `app/app.js`:

```js
var CONFIG = {
  columns: 4,            // columnas de la cuadrícula (3 a 7)
  rows: 3,               // filas de la cuadrícula
  maxFavorites: 4,       // favoritos en el dock
  tile: 261,             // ancho de cada ficha en px
  hideHintsAfter: 9000,  // ms hasta ocultar la ayuda (0 = siempre visible)
  greetName: "",         // nombre en el saludo. Vacío = solo "Buenas tardes"
  scenes: true,          // false deja el fondo fijo, sin cambiar con la hora
  wallpaper: "fondo.jpg",// foto propia en vez del paisaje. Vacío = paisaje dibujado
  preferred: [ ... ]     // apps que se fijan solas la primera vez
};
```

### El paisaje

Cada escena son nueve colores al principio de `app/styles.css`, en `body.amanecer`,
`body.dia`, `body.tarde` y `body.noche`: el cielo en tres alturas, el resplandor del
sol, el astro, las tres capas de colinas, los árboles y el velo que oscurece la mitad
de abajo. Cambia esos nueve y cambia el paisaje entero, sin tocar el dibujo.

La silueta de las colinas son cuatro `path` en el `<svg id="landscape">` de
`app/index.html`. El horizonte está puesto a propósito por encima del dock, así que lo
que se ve es el cielo, el sol posándose y las crestas; de ahí hacia abajo el velo lo
apaga para que las apps se lean. Si mueves las curvas, mantén el horizonte por encima
de los 294 px del viewBox.

Los tramos horarios de las escenas están en `sceneFor()`, en `app/app.js`.

### La foto que trae puesta

`app/fondo.jpg` es una foto propia recortada a 16:9. `CONFIG.wallpaper` ya apunta a ella.
Para volver al paisaje dibujado, deja `wallpaper: ""`.

Con foto, las fichas llevan su propio fondo oscuro y el velo se suaviza, así que la foto
se ve entre ellas en vez de quedar apagada. Son las reglas `body.conFoto` de
`app/styles.css`.

Sobre la foto se siguen aplicando la luz cálida y el velo de cada escena, así que el
fondo cambia de tono con la hora igual que el paisaje dibujado.

### Otra foto en vez de esta

Pon tu foto junto a `index.html` dentro de `app/` y escribe su nombre en
`CONFIG.wallpaper`. Recórtala a 1920 x 1080 y bájale el brillo a un 78 %, como la actual.

Lo que mande el encuadre debería caer a la derecha, que es la mitad que las apps dejan
libre. Una foto vertical no cabe entera: en 16:9 solo entra una franja, así que elige
antes qué parte quieres.

Si el repo va a ser público, usa solo fotos tuyas o que puedas redistribuir.

`columns` y `tile` deciden cuánto ancho ocupan las apps: 4 columnas de 261 px llegan
hasta la mitad de la pantalla, y de ahí a la derecha solo se ve el fondo. Con 6 columnas
se llena casi todo el ancho y el fondo queda tapado. Que `columns` x (`tile` + 18) no
pase de 1752 px.

Los colores están todos al principio de `styles.css`, en `#backdrop` y `#vignette`.

## Límites

Tizen no deja que una app web se quede con el botón Home ni con el Smart Hub, así que CleanTV se abre como un módulo dentro de TizenBrew. El botón Home seguirá abriendo el Home de Samsung.

Abrir los ajustes de la tele desde una app web tampoco está permitido: el panel de Info lo dice en lugar de ofrecer un botón que falla.

Cambiar de entrada necesita el privilegio `tv.window`, que no todos los modelos conceden a un módulo de TizenBrew. Cuando no está, el panel de Entradas lista las fuentes en modo de solo lectura.
