#pragma once
#include <atomic>
#include <cstdio>
#include <cstring>
#include <string>
#include <zmq.hpp>
#include <opencv2/opencv.hpp>
#include "json_utils.hpp"
#include "frame_buffer.hpp"

static const std::string WIN_NAME = "Tracker-SOL | ZMQ Display";

struct ClickCallbackData {
    zmq::socket_t*   click_sock = nullptr;
    std::atomic<int> last_frame_id{-1};
};

static ClickCallbackData g_click_data;

static void on_mouse(int event, int x, int y, int, void*) {
    const char* type = nullptr;
    if      (event == cv::EVENT_LBUTTONDOWN) type = "left";
    else if (event == cv::EVENT_RBUTTONDOWN) type = "right";
    else if (event == cv::EVENT_MBUTTONDOWN) type = "scroll";
    else return;

    if (!g_click_data.click_sock) return;

    char buf[256];
    snprintf(buf, sizeof(buf),
        "{\"frame_id\":%d,\"type\":\"%s\",\"x\":%d,\"y\":%d}",
        g_click_data.last_frame_id.load(), type, x, y);

    try {
        zmq::message_t msg(strlen(buf));
        memcpy(msg.data(), buf, strlen(buf));
        g_click_data.click_sock->send(msg, zmq::send_flags::dontwait);
        printf("[display] Clic %s (%d,%d) frame_id=%d\n",
               type, x, y, g_click_data.last_frame_id.load());
        fflush(stdout);
    } catch (...) {}
}

class DisplayManager {
    zmq::socket_t _anno_sock;
    zmq::socket_t _click_sock;
    FrameBuffer&  _frame_buf;
    int           _displayed_frame = -1;

public:
    DisplayManager(zmq::context_t& ctx, int anno_port, int click_port,
                   int anno_hwm, int click_hwm, FrameBuffer& frame_buf)
        : _anno_sock(ctx, zmq::socket_type::pull)
        , _click_sock(ctx, zmq::socket_type::push)
        , _frame_buf(frame_buf)
    {
        _anno_sock.set(zmq::sockopt::rcvhwm, anno_hwm);
        char ep[64];
        snprintf(ep, sizeof(ep), "tcp://*:%d", anno_port);
        _anno_sock.bind(ep);
        printf("[display] Annotations (Python->C++) : %s\n", ep);

        _click_sock.set(zmq::sockopt::sndhwm, click_hwm);
        snprintf(ep, sizeof(ep), "tcp://*:%d", click_port);
        _click_sock.bind(ep);
        printf("[display] Clics (C++->Python) : %s\n", ep);

        g_click_data.click_sock = &_click_sock;
        cv::namedWindow(WIN_NAME, cv::WINDOW_AUTOSIZE);
        cv::setMouseCallback(WIN_NAME, on_mouse, nullptr);
    }

    // Phase 1 : verifie si le 1er message Python est arrive.
    // Retourne true si transition vers phase 2.
    // Ne consomme qu'un message (le premier).
    bool check_phase2_trigger(int current_fid) {
        zmq::message_t msg;
        if (!_anno_sock.recv(msg, zmq::recv_flags::dontwait))
            return false;
        std::string json(static_cast<char*>(msg.data()), msg.size());
        int anno_fid = parse_int_field(json, "frame_id");
        printf("[sender] Phase 2 : 1er message Python fid=%d fid_courant=%d retard=%d\n",
               anno_fid, current_fid, current_fid - anno_fid);
        fflush(stdout);
        return true;
    }

    // Phase 2 : lit toutes les annotations disponibles, dessine et affiche.
    void poll(int current_fid) {
        while (true) {
            zmq::message_t msg;
            if (!_anno_sock.recv(msg, zmq::recv_flags::dontwait)) break;

            std::string json(static_cast<char*>(msg.data()), msg.size());
            int anno_fid = parse_int_field(json, "frame_id");
            if (anno_fid < 0) continue;

            int retard = current_fid - anno_fid;
            printf("[display] Anno fid=%d fid_courant=%d retard=%d frames\n",
                   anno_fid, current_fid, retard);
            fflush(stdout);

            auto boxes = parse_boxes(json);

            int oldest = -1;
            cv::Mat frame = _frame_buf.get(anno_fid, oldest);

            if (frame.empty()) {
                if (oldest >= 0 && oldest > anno_fid) {
                    printf("[display] AVERT : frame %d introuvable (oldest=%d retard=%d)\n",
                           anno_fid, oldest, oldest - anno_fid);
                    fflush(stdout);
                }
                continue;
            }

            for (const auto& box : boxes) {
                cv::Scalar color(box.b, box.g, box.r);
                cv::rectangle(frame, cv::Point(box.x1, box.y1),
                              cv::Point(box.x2, box.y2), color, 2);
                if (!box.label.empty()) {
                    cv::putText(frame, box.label, cv::Point(box.x1, box.y1 - 4),
                                cv::FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv::LINE_AA);
                }
            }

            cv::imshow(WIN_NAME, frame);
            g_click_data.last_frame_id.store(anno_fid);
            _displayed_frame = anno_fid;
        }
    }

    int displayed_frame() const { return _displayed_frame; }

    void close() {
        cv::destroyAllWindows();
        g_click_data.click_sock = nullptr;
        _anno_sock.close();
        _click_sock.close();
    }
};
