#pragma once
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include <zmq.hpp>
#include <opencv2/opencv.hpp>

/*
 * Modes d'envoi :
 *
 *   --display (mode phase 1/2) :
 *     Phase 1 (avant 1ere annotation Python) :
 *       sndhwm = ring_size, dontwait.
 *       Au-dela du HWM, les nouvelles frames sont abandonnees (drop) au lieu
 *       de s'accumuler. Python rejoint le flux a partir des frames recentes.
 *       Le buffer local (FrameBuffer) n'est pas encore alimente.
 *
 *     Phase 2 (apres 1ere annotation Python) :
 *       Meme socket inchange. Le buffer local commence a stocker les frames
 *       pour que l'affichage puisse retrouver la frame par frame_id.
 *
 *   Sans --display :
 *     --conflate : socket PUSH avec ZMQ_CONFLATE (1 seul message en buffer).
 *                  Incompatible avec les messages multipart ; utiliser uniquement
 *                  si les parties JSON+JPEG sont envoyees comme message unique.
 *     --drop     : dontwait, frames abandonnees si buffer plein.
 *     (aucun)    : send bloquant jusqu'a ce que Python consomme.
 */
class FrameSender {
    zmq::socket_t _sock;
    bool          _dontwait;

public:
    FrameSender(zmq::context_t& ctx, const std::string& endpoint,
                bool display_mode, bool conflate, bool drop, int hwm, int ring_size)
        : _sock(ctx, zmq::socket_type::push)
    {
        if (display_mode) {
            _sock.set(zmq::sockopt::sndhwm, ring_size);
            _dontwait = true;
            printf("[sender] Mode display : sndhwm=%d dontwait (phase 1 auto)\n", ring_size);
        } else if (conflate) {
            _sock.set(zmq::sockopt::conflate, 1);
            _dontwait = false;
            printf("[sender] Mode conflate (attention : incompatible messages multipart)\n");
        } else {
            _sock.set(zmq::sockopt::sndhwm, hwm);
            _dontwait = drop;
            printf("[sender] Mode %s : sndhwm=%d\n",
                   drop ? "drop" : "attente", hwm);
        }
        _sock.bind(endpoint.c_str());
    }

    // Envoie meta JSON + JPEG en deux parties. Toujours non-bloquant en mode display.
    // Retourne true si envoyee, false si abandonnee (buffer plein, mode drop).
    bool send(const std::string& meta_json, const std::vector<uchar>& jpeg_buf,
              int frame_idx, int& drop_count)
    {
        const zmq::send_flags flags = _dontwait
            ? zmq::send_flags::dontwait
            : zmq::send_flags::none;

        zmq::message_t msg_meta(meta_json.size());
        memcpy(msg_meta.data(), meta_json.data(), meta_json.size());
        zmq::message_t msg_img(jpeg_buf.size());
        memcpy(msg_img.data(), jpeg_buf.data(), jpeg_buf.size());

        try {
            _sock.send(msg_meta, flags | zmq::send_flags::sndmore);
            _sock.send(msg_img,  flags);
        } catch (const zmq::error_t& e) {
            if (e.num() == EAGAIN) {
                ++drop_count;
                if (drop_count % 100 == 1)
                    printf("[sender] AVERT : %d frame(s) abandonnee(s)\n", drop_count);
                return false;
            }
            throw;
        }

        if (frame_idx % 50 == 0) {
            printf("[sender] frame %4d  jpeg=%zu B\n", frame_idx, jpeg_buf.size());
            fflush(stdout);
        }
        return true;
    }

    void close() {
        _sock.set(zmq::sockopt::linger, 0);
        _sock.close();
    }
};

static std::vector<uchar> encode_jpeg(const cv::Mat& frame, int quality) {
    std::vector<int> params = {cv::IMWRITE_JPEG_QUALITY, quality};
    std::vector<uchar> buf;
    cv::imencode(".jpg", frame, buf, params);
    return buf;
}
