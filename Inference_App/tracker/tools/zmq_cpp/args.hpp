#pragma once
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

struct Args {
    std::string video;
    std::string csv_path;
    int    port        = 5555;
    double fps         = 0.0;
    int    quality     = 85;
    bool   loop        = false;
    // Phase 1/2 (--display only):
    //   Phase 1 (avant 1er message Python): socket PUSH conflate, pas de buffer local.
    //   Phase 2 (apres 1er annotation Python): socket PUSH avec sndhwm=ring_size.
    // Sans --display: --conflate et --drop controlent le comportement classique.
    bool   conflate    = false;
    bool   drop        = false;
    int    hwm         = 20;
    bool   display     = false;
    int    anno_port   = 5556;
    int    click_port  = 5557;
    int    buffer_size = 30;
    int    ring_size   = 10;
};

static void usage(const char* prog) {
    fprintf(stderr,
        "Usage: %s --video <mp4> --csv <csv> [options]\n"
        "\n"
        "Options d'envoi (sans --display) :\n"
        "  --port <int>      Port ZMQ frames (defaut: 5555)\n"
        "  --fps <float>     FPS d'envoi (defaut: auto depuis CSV)\n"
        "  --quality <int>   Qualite JPEG (defaut: 85)\n"
        "  --loop            Rejouer en boucle\n"
        "  --hwm <int>       sndhwm PUSH (defaut: 20)\n"
        "  --drop            Envoi non-bloquant : frame abandonnee si buffer plein\n"
        "  --conflate        Buffer PUSH = 1 frame (toujours la plus recente)\n"
        "\n"
        "Options display (mode headless Python) :\n"
        "  --display             Activer l'affichage avec annotations Python\n"
        "                        Phase 1 auto: conflate jusqu'a la 1ere annotation\n"
        "                        Phase 2 auto: ring mode apres la 1ere annotation\n"
        "  --ring-size <int>     sndhwm phase 2 (defaut: 10)\n"
        "  --anno-port <int>     Port annotations Python->C++ (defaut: 5556)\n"
        "  --click-port <int>    Port clics C++->Python       (defaut: 5557)\n"
        "  --buffer-size <int>   Taille buffer frames display  (defaut: 30)\n",
        prog);
    exit(1);
}

static Args parse_args(int argc, char** argv) {
    Args a;
    for (int i = 1; i < argc; ++i) {
        if      (!strcmp(argv[i], "--video")       && i+1 < argc) a.video       = argv[++i];
        else if (!strcmp(argv[i], "--csv")         && i+1 < argc) a.csv_path    = argv[++i];
        else if (!strcmp(argv[i], "--port")        && i+1 < argc) a.port        = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--fps")         && i+1 < argc) a.fps         = atof(argv[++i]);
        else if (!strcmp(argv[i], "--quality")     && i+1 < argc) a.quality     = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--anno-port")   && i+1 < argc) a.anno_port   = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--click-port")  && i+1 < argc) a.click_port  = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--buffer-size") && i+1 < argc) a.buffer_size = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--hwm")         && i+1 < argc) a.hwm         = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--ring-size")   && i+1 < argc) a.ring_size   = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--loop")     ) a.loop      = true;
        else if (!strcmp(argv[i], "--drop")     ) a.drop      = true;
        else if (!strcmp(argv[i], "--conflate") ) a.conflate  = true;
        else if (!strcmp(argv[i], "--display")  ) a.display   = true;
    }
    if (a.video.empty() || a.csv_path.empty()) usage(argv[0]);
    return a;
}
