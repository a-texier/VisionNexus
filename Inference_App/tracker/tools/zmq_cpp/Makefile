# Makefile - tools/zmq_cpp/
# Produit : ../frame_sender_zmq

CXX      = g++
TARGET   = ../frame_sender_zmq
SRCS     = main.cpp
CXXFLAGS = -std=c++17 -O2

# Recherche des headers OpenCV dans les emplacements standard
OPENCV_INC := $(firstword $(wildcard /usr/include/opencv4 /usr/local/include/opencv4))
OPENCV_LIB := $(firstword $(wildcard /usr/lib /usr/local/lib))

OPENCV_CFLAGS = -I$(OPENCV_INC)
OPENCV_LIBS   = -L$(OPENCV_LIB) \
                -lopencv_core -lopencv_videoio -lopencv_imgcodecs \
                -lopencv_highgui -lopencv_imgproc

ZMQ_LIBS = -lzmq

all: $(TARGET)

$(TARGET): $(SRCS) args.hpp csv_reader.hpp json_utils.hpp frame_buffer.hpp sender.hpp display.hpp
	$(CXX) $(CXXFLAGS) $(OPENCV_CFLAGS) -o $@ $(SRCS) $(OPENCV_LIBS) $(ZMQ_LIBS)
	@echo "Build OK : $@"

clean:
	rm -f $(TARGET)

.PHONY: all clean
