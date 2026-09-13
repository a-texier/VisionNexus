./frame_sender_zmq \
    --video /path/to/sequence.mp4 \
    --csv   /path/to/annotations.csv \
    --fps   10 \
    --display \
    --ring-size   10 \   # sndhwm phase 1 + taille ring buffer Python
    --buffer-size 30 \   # frames C++ memorisees pour affichage (3 s a 10 fps)
    --anno-port  5556 \
    --click-port 5557
