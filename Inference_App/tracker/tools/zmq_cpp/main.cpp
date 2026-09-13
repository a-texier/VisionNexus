/*
 * tools/zmq_cpp/main.cpp
 * Generic C++ sender: reads MP4 + CSV and sends frames through ZMQ PUSH.
 *
 * Protocole ZMQ (3 sockets quand --display est actif) :
 *   Port 5555 : C++ PUSH -> Python PULL  (frames + meta JSON, multipart 2 parties)
 *   Port 5556 : Python PUSH -> C++ PULL  (annotations bbox JSON)
 *   Port 5557 : C++ PUSH -> Python PULL  (clics souris JSON)
 *
 * Mode display (--display) - phase 1/2 :
 *   Phase 1 : sndhwm = ring_size, dontwait.
 *             Frames abandonnees si Python non connecte : pas d'accumulation.
 *             Python rejoint le flux recent via le startup drain de son ring buffer.
 *             Buffer local de frames non alimente (pas d'affichage).
 *
 *   Phase 2 : declenche par le 1er message d'annotation Python.
 *             Buffer local alimente : les frames sont stockees pour l'affichage.
 *             Annotations recues -> bboxes dessinees -> imshow.
 *             Clics souris -> envoyes a Python pour trigger SOT.
 *
 * Sans --display : mode classique avec --conflate / --drop / --hwm.
 *
 * Compilation : make (dans tools/zmq_cpp/)
 */

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <thread>

#include <zmq.hpp>
#include <opencv2/opencv.hpp>

#include "args.hpp"
#include "csv_reader.hpp"
#include "json_utils.hpp"
#include "frame_buffer.hpp"
#include "sender.hpp"
#include "display.hpp"

int main(int argc, char** argv) {
    Args args = parse_args(argc, argv);

    //####CSV
    double fps_csv = 0.0;
    auto meta_rows = load_csv(args.csv_path, fps_csv);
    if (meta_rows.empty()) {
        fprintf(stderr, "[sender] ERREUR : CSV vide ou illisible.\n");
        return 1;
    }

    //####Video
    cv::VideoCapture cap(args.video);
    if (!cap.isOpened()) {
        fprintf(stderr, "[sender] ERREUR : impossible d'ouvrir %s\n", args.video.c_str());
        return 1;
    }
    const double fps_vid = cap.get(cv::CAP_PROP_FPS);
    const int    n_vid   = static_cast<int>(cap.get(cv::CAP_PROP_FRAME_COUNT));
    printf("[sender] Video : %s  frames=%d  fps_vid=%.2f\n",
           args.video.c_str(), n_vid, fps_vid);

    //####FPS d'envoi (priorite : --fps > CSV > video > 10)
    double fps = args.fps;
    if (fps <= 0.0) fps = (fps_csv > 0.0) ? fps_csv : fps_vid;
    if (fps <= 0.0) fps = 10.0;
    const long interval_us = static_cast<long>(1e6 / fps);

    //####ZMQ context + sender
    zmq::context_t ctx(1);
    char frame_ep[64];
    snprintf(frame_ep, sizeof(frame_ep), "tcp://*:%d", args.port);
    FrameSender sender(ctx, frame_ep,
                       args.display, args.conflate,
                       args.drop, args.hwm, args.ring_size);

    printf("[sender] FPS=%.2f  qualite=%d  loop=%s\n",
           fps, args.quality, args.loop ? "oui" : "non");

    //####Display
    FrameBuffer    frame_buf(args.buffer_size);
    DisplayManager* disp = nullptr;
    if (args.display) {
        disp = new DisplayManager(ctx, args.anno_port, args.click_port,
                                  8, 32, frame_buf);
        printf("[sender] Display actif  buffer_size=%d  ring_size=%d\n",
               args.buffer_size, args.ring_size);
        printf("[sender] Phase 1 : en attente du 1er message Python (frame buffer inactif)\n");
    }

    printf("[sender] Envoi sur tcp://*:%d\n", args.port);
    fflush(stdout);

    //####Boucle principale
    int  total_frame = 0;
    int  drop_count  = 0;
    bool phase2      = !args.display;   // sans display : pas de phase 1/2

    do {
        if (total_frame > 0)
            cap.set(cv::CAP_PROP_POS_FRAMES, 0);

        int seq_frame = 0;
        cv::Mat frame;

        while (cap.read(frame)) {
            if (frame.empty()) break;

            auto t_start = std::chrono::steady_clock::now();

            const size_t meta_idx = std::min(
                static_cast<size_t>(seq_frame), meta_rows.size() - 1);
            const MetaRow& r    = meta_rows[meta_idx];
            const auto     meta = make_meta_json(r, total_frame);
            const auto     jpeg = encode_jpeg(frame, args.quality);

            sender.send(meta, jpeg, total_frame, drop_count);

            if (disp) {
                if (phase2) {
                    frame_buf.push(total_frame, frame);
                    disp->poll(total_frame);
                } else {
                    if (disp->check_phase2_trigger(total_frame)) {
                        phase2 = true;
                        printf("[sender] Phase 2 : frame buffer et affichage actifs\n");
                        fflush(stdout);
                    }
                }
                int key = cv::waitKey(1);
                if (key == 'q' || key == 27) {
                    printf("[display] Arret demande (q/Echap).\n");
                    goto done;
                }
            }

            ++seq_frame;
            ++total_frame;

            auto t_end   = std::chrono::steady_clock::now();
            long elapsed = std::chrono::duration_cast<std::chrono::microseconds>(
                               t_end - t_start).count();
            long sleep_us = interval_us - elapsed;
            if (sleep_us > 0)
                std::this_thread::sleep_for(std::chrono::microseconds(sleep_us));
        }

        printf("[sender] Fin sequence : %d frames  abandonnees=%d\n",
               seq_frame, drop_count);

    } while (args.loop);

done:
    cap.release();
    if (disp) {
        disp->close();
        delete disp;
    }
    sender.close();
    printf("[sender] Termine. total=%d  abandonnees=%d\n",
           total_frame - drop_count, drop_count);
    return 0;
}
