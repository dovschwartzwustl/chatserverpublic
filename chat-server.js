
// Require the packages we will use:
const http = require("http"),
fs = require("fs");
const { v4: uuidv4 } = require('uuid');

const port = 3456;
const file = "client.html";
//each room has participants, room name, creator, password, bannedlist
const chatRooms= {};
//stored as username : socket
const users = {};
//stored as chatRoomId: list of usernames
const typingUsers = {};
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

// Import Socket.IO and pass our HTTP server object to it. This worked over the old way
const socketio = require("socket.io")(server);
/*
const socketio = require("socket.io")(http, {
  wsEngine: 'ws'
});
*/

//Emit all of the current rooms to the client (for the drop down menu)
function emitCurrentRooms() {
  const rooms = Object.entries(chatRooms).map(([roomId, chatroom]) => {
    return {
      roomId: roomId,
      roomName: chatroom.roomName,
    };
  });
  socketio.sockets.emit("current_rooms", rooms);
}

//Emits all of the current users in a room
function emitCurrentRoomUsers(roomId) {
  const usersInRoom = [];
  
  const chatroom = chatRooms[roomId];
  if (chatroom) {
    chatroom.participants.forEach(socketId => {
      for (const username in users) {
        const socket = users[username];
        if (socket.id === socketId) {
          usersInRoom.push({ username: username, socketId: socketId });
          break;
        }
      }
  });
  
  socketio.sockets.to(roomId).emit("current-room-users", {
    usersInRoom: usersInRoom,
    creatorId: chatRooms[roomId].creator.id
  });
}
}


//Main non-blocking I/O segment
socketio.sockets.on("connection", function (socket) {
  //always emits rooms on a new connection
  emitCurrentRooms();
  //handles when a user starts typing
  socket.on("startTyping", function({ room, username }){
    if (!typingUsers[room]) {
      typingUsers[room] = [];
    }
    if (!typingUsers[room].includes(username)) {
      typingUsers[room].push(username);
  
      //emits the typing users list
      socket.to(room).emit("typingIndicator", { users: typingUsers[room] });
    }
  })
  
  //handles when a user stops typing
  socket.on("stopTyping", function({ room, username }){
    if (typingUsers[room]) {
      typingUsers[room] = typingUsers[room].filter(function(user) {
        return user !== username;
      });
  
      //emits the typing users list
      socket.to(room).emit("typingIndicator", { users: typingUsers[room] });
    }
  });

  //Function: adds new user to users object
  socket.on("new-user", function (username) {
    users[username] = socket;
    socket.emit("socket_id", socket.id);
  })

  //Function: Adds user to banned list, removes them from room
  socket.on("ban-user", function(data) {
    var roomId = data.roomId;
    var socketId = data.socketId;
    if (chatRooms[roomId]) {
      chatRooms[roomId].bannedList.add(socketId);
      leaveRoom(roomId, socketId);

      var bannedUserName = data.username;
      socketio.sockets.to(roomId).emit("message_to_client", {
        message: bannedUserName + " has been banned",
        roomId: roomId
      });
      socket.to(socketId).emit("banned-from-room");
    }
    
  })

  //Function: Kicks user, removes them from room (they can rejoin)
  socket.on("kick-user", function(data) {
    var roomId = data.roomId;
    var socketId = data.socketId;
    if (chatRooms[roomId]) {
      leaveRoom(roomId, socketId);

      var kickedUserName = data.username;
      socketio.sockets.to(roomId).emit("message_to_client", {
        message: kickedUserName + " has been kicked",
        roomId: roomId
      });
      socket.to(socketId).emit("kicked-from-room");
    }
  })

  //Function: creates a new chatroom
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

    //generate a unique chatroom ID
    const chatroomId = generateChatroomId();
    //join the specified chatroom
    socket.join(chatroomId);
    
    // Create the chatroom, storing participants, name, password if there is one, creator, and banned list
    if (!chatRooms[chatroomId]) {
      chatRooms[chatroomId] = {
        participants: new Set(),
        roomName: roomName, 
        password: password,
        creator: socket,
        bannedList: new Set()
      };
    }
    
    //add the participant(creator) to the chatroom
    chatRooms[chatroomId].participants.add(socket.id);
    
    //var curUsers = getUsersInRoom(chatroomId);
    //socket.to(chatroomId).emit("current-room-users", curUsers);
    //socket.emit("current-room-users", curUsers);

    //display new list of rooms and users in that room
    emitCurrentRooms();
    emitCurrentRoomUsers(chatroomId);

    //gives the client the info on the chatroom they are in
    socket.emit("new_room_id", chatroomId);

    
  });

  socket.on("join_chatroom", function (chatroomId) {
    //make sure user isn't on banned list for that chatRoom
    if(chatRooms[chatroomId].bannedList.has(socket.id)) {
      socket.emit("banned_cant_join");
    } else {
          const currentChatroomId = getChatroomIdForSocket(socket);
          
          //leave the current chatroom if the user is in one
          if (currentChatroomId) {
            //remove the participant from the chatroom
            chatRooms[currentChatroomId].participants.delete(socket.id);
            
            //if there are no participants left in the chatroom, remove it
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
          
          //check if the chatroom is password protected
          //if the creator of the room left and wants to rejoin, they don't have to enter the password
          if (chatRooms[chatroomId].password && socket.id != chatRooms[chatroomId].creator.id) {
            //prompt the user for a password
            promptForPassword();
          } else {
            //join the specified chatroom (no password required)
            socket.join(chatroomId);
            
            //add the participant to the chatroom
            chatRooms[chatroomId].participants.add(socket.id);
            
            socket.emit("joined_room_info", {
              roomId: chatroomId,
              roomName: chatRooms[chatroomId].roomName
            });
            
            emitCurrentRooms();
            emitCurrentRoomUsers(chatroomId);
          }
        }
  });


  
  //receiving a message from client, sending it back
  socket.on("message_to_server", function (data) {
    
    const chatroomId = data["roomId"];
    
    if (chatroomId) {
      console.log(
        data["username"] + " (" + chatroomId + "): " + data["message"]
        ); 

        //to the client who sent it
        socket.emit("message_to_client", {
          message: "You: " + data.message,
          roomId: chatroomId
        });

        //to the other people in room
        socket.to(chatroomId).emit("message_to_client", {
          message: data["username"] + ": " + data["message"],
          roomId: chatroomId
        });
      }
    });

    //Function for sending a private message
    socket.on("private-message", function(data) {
      //takes in info about the private message
      const senderUsername = data.senderUsername;
      const receiverSocketId = data.receiverSocketId;
      const message = data.message;
      let receiverUsername;
      console.log("priv message: "+ message + " to: "+ receiverSocketId)
    
      //making sure receiverSocketId and users are valid
      if (receiverSocketId && users) {
        console.log("passed if")
        let receiverSocket;
        //getting the proper receiver socket from user's map
        //this was one of the last functions created
        //in retrospect, would have restructured user's map to avoid this loop
        for (const username in users) {
          if (users[username].id === receiverSocketId) {
            receiverSocket = users[username];
            receiverUsername = username;
            break;
          }
        }
        
        //to the receiver
        receiverSocket.emit("private-message", {
          senderUsername: senderUsername,
          receiverUsername: "You",
          message: message
        });
        //to the sender
        socket.emit("private-message", {
          senderUsername: "You",
          receiverUsername: receiverUsername,
          message: message
        });
      }
    });
    
    //Function: leaving a room
    socket.on("leave-room", function () {
      const chatroomId = getChatroomIdForSocket(socket);
      socket.emit("left-room", chatroomId);
    
      leaveRoom(chatroomId, socket.id);
    });
    
  });
  


//
//ALL EXTERIOR FUNCTIONS
//



  function generateChatroomId() {
    return uuidv4();
  }

  function leaveRoom(chatroomId, socketId) {
    if (chatroomId) {
      // Remove the participant from the chatroom
      chatRooms[chatroomId].participants.delete(socketId);
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
  }
  
  //gets the chat room id that the socket is in
  function getChatroomIdForSocket(socket) {
    // Iterate through chat rooms to find the chat room the socket belongs to
    for (const [chatroomId, chatroom] of Object.entries(chatRooms)) {
      if (chatroom.participants.has(socket.id)) {
        return chatroomId;
      }
    }
    return null; // Return null if the socket is not associated with any chat room
  }
  
