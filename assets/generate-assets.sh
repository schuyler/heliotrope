rsvg-convert -w 824 -h 824 sun.svg -o sun.png
convert sun.png \( +clone -background black -shadow 80x3+5+5 \) +swap -background SkyBlue1 -layers merge +repage \
 -gravity center -extent 1024x1024 icon.png
convert icon.png -background SkyBlue1 -gravity center -extent 1284x2778 splash.png
