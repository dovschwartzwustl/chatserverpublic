
// Require the packages we will use:
const http = require("http"),
fs = require("fs");
const { v4: uuidv4 } = require('uuid');

const port = 3456;
const file = "client.html";

const chatRooms= {};
const users = {};
// Listen for HTTP connections.  This is essentially a miniature static file server that only serves our one file, client.html, on port 3456:
const server = http.createServer(function (req, res) {
  // This callback runs when a new connection is made to our HTTP server.
  
  fs.readFile(file, function (err, data) {
    // This callback runs when the client.html file has been read from the filesystem.
    
    if (err) return res.writeHead(500);
    res.writeHead(200);
    res.end(data);
  });
});
server.listen(port);

// Import Socket.IO and pass our HTTP server object to it.
const socketio = require("socket.io")(server);
/*
const socketio = require("socket.io")(http, {
  wsEngine: 'ws'
});
*/

function emitCurrentRooms() {
  const rooms = Object.entries(chatRooms).map(([roomId, chatroom]) => {
    return {
      roomId: roomId,
      roomName: chatroom.roomName,
    };
  });
  socketio.sockets.emit("current_rooms", rooms);
}

function emitCurrentRoomUsers(roomId) {
  const usersInRoom = [];
  
  const chatroom = chatRooms[roomId];
  if (chatroom) {
    chatroom.participants.forEach(socketId => {
      for (const username in users) {
        const socket = users[username];
        if (socket.id === socketId) {
          usersInRoom.push(username);
          break;
        }
      }
  });
  
  //socketio.sockets.emit("current-room-users", usersInRoom);
  socketio.sockets.to(roomId).emit("current-room-users", usersInRoom);
}
}


// Attach our Socket.IO server to listen for connections
socketio.sockets.on("connection", function (socket) {
  emitCurrentRooms();
  // This callback runs when a new Socket.IO connection is established.
  
  socket.on("new-user", function (username) {
    users[username] = socket;
  })


  socket.on("create_chatroom", function ({ roomName, password }) {
    const currentChatroomId = getChatroomIdForSocket(socket);
    // Leave the current chatroom if the user is in one
    if (currentChatroomId) {
      // Remove the participant from the chatroom
      
      chatRooms[currentChatroomId].participants.delete(socket.id);
      
  
      // If there are no participants left in the chatroom, remove it
      if (chatRooms[currentChatroomId].participants.size === 0) {
        delete chatRooms[currentChatroomId];
        emitCurrentRooms();
      }
    }

    const chatroomId = generateChatroomId(); // Generate a unique chatroom ID
    // Join the specified chatroom
    socket.join(chatroomId);
    
    // Create the chatroom if it doesn't exist
    if (!chatRooms[chatroomId]) {
      chatRooms[chatroomId] = {
        participants: new Set(),
        roomName: roomName, // Store the room name in the chatroom object
        password: password,
        creator: socket
      };
    }
    
    // Add the participant to the chatroom
    chatRooms[chatroomId].participants.add(socket.id);
    
    //var curUsers = getUsersInRoom(chatroomId);
    //socket.to(chatroomId).emit("current-room-users", curUsers);
    //socket.emit("current-room-users", curUsers);

    emitCurrentRooms();
    emitCurrentRoomUsers(chatroomId);

    socket.emit("new_room_id", chatroomId);

    
  });

  socket.on("join_chatroom", function (chatroomId) {
    const currentChatroomId = getChatroomIdForSocket(socket);
    
    // Leave the current chatroom if the user is in one
    if (currentChatroomId) {
      // Remove the participant from the chatroom
      chatRooms[currentChatroomId].participants.delete(socket.id);
  
      // If there are no participants left in the chatroom, remove it
      if (chatRooms[currentChatroomId].participants.size === 0) {
        delete chatRooms[currentChatroomId];
        emitCurrentRooms();
      }
    }

    //function to prompt for password
    function promptForPassword() {
      socket.emit("password_prompt");
      socket.once("password_submit", function(password) {
        //check if the entered password matches the chatroom's password
        if (password === chatRooms[chatroomId].password) {
          //join the specified chatroom
          socket.join(chatroomId);
  
          //add the participant to the chatroom
          chatRooms[chatroomId].participants.add(socket.id);
  
          socket.emit("joined_room_info", {
            roomId: chatroomId,
            roomName: chatRooms[chatroomId].roomName
          });
  
          emitCurrentRooms();
          emitCurrentRoomUsers(chatroomId);
        } else {
          //password incorrect
          promptForPassword();
        }
      });
    }
    
      // Check if the chatroom is password protected
      // if the creator of the room left and wants to rejoin, they don't have to enter the password
    if (chatRooms[chatroomId].password && socket.id != chatRooms[chatroomId].creator.id) {
      // Prompt the user for a password
      promptForPassword();
    } else {
      // Join the specified chatroom (no password required)
      socket.join(chatroomId);

      // Add the participant to the chatroom
      chatRooms[chatroomId].participants.add(socket.id);

      socket.emit("joined_room_info", {
        roomId: chatroomId,
        roomName: chatRooms[chatroomId].roomName
      });

      emitCurrentRooms();
      emitCurrentRoomUsers(chatroomId);
    }
  });


  
  
  socket.on("message_to_server", function (data) {
    // This callback runs when the server receives a new message from the client.
    
    const chatroomId = data["roomId"];
    
    if (chatroomId) {
      console.log(
        data["username"] + " (" + chatroomId + "): " + data["message"]
        ); // log it to the Node.JS output

        //to the client who sent it
        socket.emit("message_to_client", {
          message: data.username + ": " + data.message,
          roomId: chatroomId
        });

        //to the other people in room
        socket.to(chatroomId).emit("message_to_client", {
          message: data["username"] + ": " + data["message"],
          roomId: chatroomId
        });
      }
    });
    
    socket.on("leave-room", function () {
      const chatroomId = getChatroomIdForSocket(socket);
      socket.emit("left-room", chatroomId)
    
      if (chatroomId) {
        // Remove the participant from the chatroom
        chatRooms[chatroomId].participants.delete(socket.id);
        //update the cur user list
        //var curUsers = getUsersInRoom(chatroomId);
        //socket.to(chatroomId).emit("current-room-users", curUsers);
        //socket.emit("current-room-users", curUsers);
        emitCurrentRoomUsers(chatroomId);

    
        // If there are no participants left in the chatroom, remove it
        if (chatRooms[chatroomId].participants.size === 0) {
          delete chatRooms[chatroomId];
          emitCurrentRooms();
          
        }
      }
    });
    
  });
  
  function generateChatroomId() {
    return uuidv4();
  }
  
  function getChatroomIdForSocket(socket) {
    // Iterate through chat rooms to find the chat room the socket belongs to
    for (const [chatroomId, chatroom] of Object.entries(chatRooms)) {
      if (chatroom.participants.has(socket.id)) {
        return chatroomId;
      }
    }
    return null; // Return null if the socket is not associated with any chat room
  }

  function getUsersInRoom(roomId) {
    const usersInRoom = [];
    
    const chatroom = chatRooms[roomId];
  if (chatroom) {
    chatroom.participants.forEach(socketId => {
      for (const username in users) {
        const socket = users[username];
        if (socket.id === socketId) {
          usersInRoom.push(username);
          break;
        }
      }
    });
  }
    
    
    /*
    console.log(`Users in room ${roomId}:`);
    usersInRoom.forEach(username => {
      console.log(`Username: ${username}`);
    });
    */
    
    return usersInRoom;
  }
  
